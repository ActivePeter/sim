import { db } from '@sim/db'
import { usageLog, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  toBillingContext,
} from '@/lib/billing/core/billing-attribution'
import { recordUsage, stableEventKey } from '@/lib/billing/core/usage-log'
import {
  assertSandboxPricingSnapshot,
  createSandboxPricingSnapshot,
  priceSandboxUsage,
  type SandboxPricingSnapshot,
} from '@/lib/billing/sandbox-pricing'
import { checkAndBillPayerOverageThreshold } from '@/lib/billing/threshold-billing'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import {
  enqueueOutboxEvent,
  type OutboxEventContext,
  type OutboxHandlerRegistry,
  patchAndReleasePendingOutboxEvent,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { getSandboxProvider } from '@/lib/execution/remote-sandbox/provider'
import type {
  SandboxProviderId,
  SandboxUsageContext,
  SandboxUsageOutcome,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('SandboxUsageOutbox')

export const SANDBOX_USAGE_OUTBOX_EVENT_TYPE = 'sandbox.usage.finalize'
const CRASH_RECOVERY_GRACE_MS = 60_000

export type SandboxUsageCleanupStatus = 'active' | 'terminated' | 'pending_reconciliation'

export interface SandboxUsageOutboxPayloadV1 {
  version: 1
  provider: SandboxProviderId
  providerSandboxId: string
  sandboxKind: 'code' | 'shell'
  providerRequestedAt: string
  providerReadyAt: string
  providerExpiresAt: string
  terminationRequestedAt?: string
  terminatedAt?: string
  outcome?: SandboxUsageOutcome
  cleanupStatus: SandboxUsageCleanupStatus
  workspaceId: string
  workflowId: string
  executionId: string
  billingAttribution: BillingAttributionSnapshot
  pricing: SandboxPricingSnapshot
}

export interface BeginSandboxUsageParams {
  provider: SandboxProviderId
  providerSandboxId: string
  sandboxKind: 'code' | 'shell'
  providerRequestedAt: Date
  providerReadyAt: Date
  providerExpiresAt: Date
  usageContext: SandboxUsageContext
}

export interface ReleaseSandboxUsagePatch {
  terminationRequestedAt: Date
  terminatedAt?: Date
  outcome: SandboxUsageOutcome
  cleanupStatus: Exclude<SandboxUsageCleanupStatus, 'active'>
}

function sandboxUsageEventKey(provider: SandboxProviderId, providerSandboxId: string): string {
  return stableEventKey({
    kind: 'sandbox_usage_v1',
    provider,
    providerSandboxId,
  })
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new Error(`Sandbox usage ${field} must be an ISO date string`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Sandbox usage ${field} must be a valid ISO date string`)
  }
  return date
}

function parseRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Sandbox usage ${field} must be a non-empty string`)
  }
  return value
}

function parseSandboxUsagePayload(value: unknown): SandboxUsageOutboxPayloadV1 {
  if (!isRecordLike(value) || value.version !== 1) {
    throw new Error('Sandbox usage outbox payload version is invalid')
  }
  if (value.provider !== 'e2b' && value.provider !== 'daytona') {
    throw new Error('Sandbox usage provider is invalid')
  }
  if (value.sandboxKind !== 'code' && value.sandboxKind !== 'shell') {
    throw new Error('Sandbox usage kind is invalid')
  }
  if (
    value.cleanupStatus !== 'active' &&
    value.cleanupStatus !== 'terminated' &&
    value.cleanupStatus !== 'pending_reconciliation'
  ) {
    throw new Error('Sandbox usage cleanup status is invalid')
  }
  if (
    value.outcome !== undefined &&
    value.outcome !== 'success' &&
    value.outcome !== 'user_error' &&
    value.outcome !== 'timeout' &&
    value.outcome !== 'cancelled' &&
    value.outcome !== 'infrastructure_error'
  ) {
    throw new Error('Sandbox usage outcome is invalid')
  }

  const providerRequestedAt = parseDate(value.providerRequestedAt, 'providerRequestedAt')
  const providerReadyAt = parseDate(value.providerReadyAt, 'providerReadyAt')
  const providerExpiresAt = parseDate(value.providerExpiresAt, 'providerExpiresAt')
  const terminationRequestedAt =
    value.terminationRequestedAt === undefined
      ? undefined
      : parseDate(value.terminationRequestedAt, 'terminationRequestedAt')
  const terminatedAt =
    value.terminatedAt === undefined ? undefined : parseDate(value.terminatedAt, 'terminatedAt')
  if (providerReadyAt < providerRequestedAt || providerExpiresAt <= providerRequestedAt) {
    throw new Error('Sandbox usage provider timestamps are inconsistent')
  }

  const workspaceId = parseRequiredString(value.workspaceId, 'workspaceId')
  const billingAttribution = assertBillingAttributionSnapshot(value.billingAttribution)
  if (billingAttribution.workspaceId !== workspaceId) {
    throw new Error('Sandbox usage workspace does not match billing attribution')
  }

  const pricing = assertSandboxPricingSnapshot(value.pricing)
  if (pricing.provider !== value.provider) {
    throw new Error('Sandbox usage provider does not match its pricing snapshot')
  }

  return {
    version: 1,
    provider: value.provider,
    providerSandboxId: parseRequiredString(value.providerSandboxId, 'providerSandboxId'),
    sandboxKind: value.sandboxKind,
    providerRequestedAt: providerRequestedAt.toISOString(),
    providerReadyAt: providerReadyAt.toISOString(),
    providerExpiresAt: providerExpiresAt.toISOString(),
    ...(terminationRequestedAt
      ? { terminationRequestedAt: terminationRequestedAt.toISOString() }
      : {}),
    ...(terminatedAt ? { terminatedAt: terminatedAt.toISOString() } : {}),
    ...(value.outcome ? { outcome: value.outcome } : {}),
    cleanupStatus: value.cleanupStatus,
    workspaceId,
    workflowId: parseRequiredString(value.workflowId, 'workflowId'),
    executionId: parseRequiredString(value.executionId, 'executionId'),
    billingAttribution,
    pricing,
  }
}

export async function beginSandboxUsage(params: BeginSandboxUsageParams): Promise<string> {
  const eventId = sandboxUsageEventKey(params.provider, params.providerSandboxId)
  const billingAttribution = assertBillingAttributionSnapshot(
    params.usageContext.billingAttribution
  )
  if (billingAttribution.workspaceId !== params.usageContext.workspaceId) {
    throw new Error('Sandbox usage workspace does not match billing attribution')
  }
  const payload: SandboxUsageOutboxPayloadV1 = {
    version: 1,
    provider: params.provider,
    providerSandboxId: params.providerSandboxId,
    sandboxKind: params.sandboxKind,
    providerRequestedAt: params.providerRequestedAt.toISOString(),
    providerReadyAt: params.providerReadyAt.toISOString(),
    providerExpiresAt: params.providerExpiresAt.toISOString(),
    cleanupStatus: 'active',
    workspaceId: params.usageContext.workspaceId,
    workflowId: params.usageContext.workflowId,
    executionId: params.usageContext.executionId,
    billingAttribution,
    pricing: createSandboxPricingSnapshot(params.provider),
  }

  await enqueueOutboxEvent(db, SANDBOX_USAGE_OUTBOX_EVENT_TYPE, payload, {
    id: eventId,
    availableAt: new Date(params.providerExpiresAt.getTime() + CRASH_RECOVERY_GRACE_MS),
  })
  return eventId
}

export async function releaseAndProcessSandboxUsage(
  eventId: string,
  patch: ReleaseSandboxUsagePatch
): Promise<void> {
  const released = await patchAndReleasePendingOutboxEvent(db, eventId, {
    terminationRequestedAt: patch.terminationRequestedAt.toISOString(),
    ...(patch.terminatedAt ? { terminatedAt: patch.terminatedAt.toISOString() } : {}),
    outcome: patch.outcome,
    cleanupStatus: patch.cleanupStatus,
  })
  if (!released) {
    logger.warn('Sandbox usage outbox event was not pending when released', { eventId })
    return
  }

  const result = await processOutboxEventById(eventId, sandboxUsageOutboxHandlers)
  if (result !== 'completed') {
    logger.warn('Sandbox usage outbox event deferred after immediate processing', {
      eventId,
      result,
    })
  }
}

async function reconcileTermination(
  payload: SandboxUsageOutboxPayloadV1,
  context: OutboxEventContext
): Promise<SandboxUsageOutboxPayloadV1> {
  if (payload.terminatedAt) return payload

  const terminationRequestedAt = payload.terminationRequestedAt ?? new Date().toISOString()
  const terminationResult = await getSandboxProvider(payload.provider).terminateById(
    payload.providerSandboxId
  )
  const terminatedAt =
    terminationResult === 'not_found'
      ? new Date(
          Math.min(
            new Date(terminationRequestedAt).getTime(),
            new Date(payload.providerExpiresAt).getTime()
          )
        ).toISOString()
      : new Date().toISOString()
  const patch = {
    terminationRequestedAt,
    terminatedAt,
    cleanupStatus: 'terminated' as const,
  }
  await context.checkpointPayload(patch)
  return { ...payload, ...patch }
}

async function finalizeSandboxUsage(
  rawPayload: unknown,
  context: OutboxEventContext
): Promise<void> {
  const parsed = parseSandboxUsagePayload(rawPayload)
  const payload = await reconcileTermination(parsed, context)
  if (!payload.terminatedAt) {
    throw new Error('Sandbox usage termination reconciliation did not produce a timestamp')
  }
  const pricing = priceSandboxUsage(
    payload.pricing,
    new Date(payload.providerRequestedAt),
    new Date(payload.terminatedAt),
    new Date(payload.providerExpiresAt)
  )
  const billingContext = toBillingContext(payload.billingAttribution)

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${payload.executionId}, 0))`)
    const insertedCost = await recordUsage({
      userId: payload.billingAttribution.actorUserId,
      entries: [
        {
          category: 'tool',
          source: 'workflow',
          description: 'Code sandbox',
          cost: pricing.billedCost,
          eventKey: sandboxUsageEventKey(payload.provider, payload.providerSandboxId),
          sourceReference: `sandbox:${payload.provider}:${payload.providerSandboxId}`,
          metadata: {
            provider: payload.provider,
            providerSandboxId: payload.providerSandboxId,
            sandboxKind: payload.sandboxKind,
            durationMs: pricing.durationMs,
            sandboxSeconds: pricing.sandboxSeconds,
            vcpuSeconds: pricing.vcpuSeconds,
            memoryGiBSeconds: pricing.memoryGiBSeconds,
            diskGiBSeconds: pricing.diskGiBSeconds,
            rawCost: pricing.rawCost,
            resources: payload.pricing.resources,
            rates: payload.pricing.rates,
            multiplier: payload.pricing.multiplier,
            pricingVersion: payload.pricing.version,
            pricingVerifiedAt: payload.pricing.verifiedAt,
            outcome: payload.outcome ?? 'infrastructure_error',
            cleanupStatus: payload.cleanupStatus,
          },
        },
      ],
      workspaceId: payload.workspaceId,
      workflowId: payload.workflowId,
      executionId: payload.executionId,
      tx,
      billingEntity: billingContext.billingEntity,
      billingPeriod: billingContext.billingPeriod,
    })

    const [ledger] = await tx
      .select({ cost: sql<string>`COALESCE(SUM(${usageLog.cost}), 0)` })
      .from(usageLog)
      .where(and(eq(usageLog.executionId, payload.executionId), eq(usageLog.source, 'workflow')))
    const ledgerCost = ledger?.cost ?? '0'
    await tx
      .update(workflowExecutionLogs)
      .set({
        costTotal: sql`GREATEST(COALESCE(${workflowExecutionLogs.costTotal}, 0) + ${insertedCost.toString()}::numeric, ${ledgerCost}::numeric)`,
      })
      .where(eq(workflowExecutionLogs.executionId, payload.executionId))
  })

  if (isBillingEnabled) {
    await checkAndBillPayerOverageThreshold(billingContext.billingEntity, { onError: 'throw' })
  }

  logger.info('Recorded Function sandbox usage', {
    provider: payload.provider,
    providerSandboxId: payload.providerSandboxId,
    executionId: payload.executionId,
    durationMs: pricing.durationMs,
    billedCost: pricing.billedCost,
  })
}

export const sandboxUsageOutboxHandlers: OutboxHandlerRegistry = {
  [SANDBOX_USAGE_OUTBOX_EVENT_TYPE]: async (payload, context) => {
    try {
      await finalizeSandboxUsage(payload, context)
    } catch (error) {
      logger.error('Failed to finalize Function sandbox usage', {
        eventId: context.eventId,
        error: getErrorMessage(error),
      })
      throw error
    }
  },
}
