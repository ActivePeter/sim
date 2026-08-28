/**
 * @vitest-environment node
 */

import { usageLog } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRecordUsage, mockTerminateById, mockThresholdBilling } = vi.hoisted(() => ({
  mockRecordUsage: vi.fn(),
  mockTerminateById: vi.fn(),
  mockThresholdBilling: vi.fn(),
}))

vi.mock('@/lib/billing/core/usage-log', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/billing/core/usage-log')>()
  return { ...original, recordUsage: mockRecordUsage }
})
vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mockThresholdBilling,
}))
vi.mock('@/lib/core/config/env-flags', () => ({
  getCostMultiplier: vi.fn(() => 1),
  isBillingEnabled: false,
}))
vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  getSandboxProvider: vi.fn(() => ({ terminateById: mockTerminateById })),
}))

import { createSandboxPricingSnapshot } from '@/lib/billing/sandbox-pricing'
import {
  SANDBOX_USAGE_OUTBOX_EVENT_TYPE,
  type SandboxUsageOutboxPayloadV1,
  sandboxUsageOutboxHandlers,
} from '@/lib/billing/sandbox-usage-outbox'
import type { OutboxEventContext } from '@/lib/core/outbox/service'

const context: OutboxEventContext = {
  eventId: 'event-1',
  eventType: SANDBOX_USAGE_OUTBOX_EVENT_TYPE,
  attempts: 0,
  maxAttempts: 10,
  signal: new AbortController().signal,
  checkpointPayload: vi.fn(),
}

function payload(overrides: Partial<SandboxUsageOutboxPayloadV1> = {}) {
  const base: SandboxUsageOutboxPayloadV1 = {
    version: 1,
    provider: 'e2b',
    providerSandboxId: 'sandbox-1',
    sandboxKind: 'code',
    providerRequestedAt: '2026-08-27T12:00:00.000Z',
    providerReadyAt: '2026-08-27T12:00:01.000Z',
    providerExpiresAt: '2026-08-27T12:05:00.000Z',
    terminationRequestedAt: '2026-08-27T12:00:10.000Z',
    terminatedAt: '2026-08-27T12:00:10.000Z',
    outcome: 'success',
    cleanupStatus: 'terminated',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    billingAttribution: {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      organizationId: null,
      billedAccountUserId: 'user-1',
      billingEntity: { type: 'user', id: 'user-1' },
      billingPeriod: {
        start: '2026-08-01T00:00:00.000Z',
        end: '2026-09-01T00:00:00.000Z',
      },
      payerSubscription: null,
    },
    pricing: createSandboxPricingSnapshot('e2b', 1),
  }
  return { ...base, ...overrides }
}

async function runHandler(value: SandboxUsageOutboxPayloadV1): Promise<void> {
  await sandboxUsageOutboxHandlers[SANDBOX_USAGE_OUTBOX_EVENT_TYPE](value, context)
}

afterAll(resetDbChainMock)

describe('sandbox usage outbox finalizer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(usageLog, [{ cost: '0.02' }])
    mockRecordUsage.mockResolvedValue(undefined)
    mockTerminateById.mockResolvedValue('terminated')
  })

  it('records an attributed Code sandbox ledger event and refreshes execution cost', async () => {
    await runHandler(payload())

    expect(mockRecordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        tx: expect.anything(),
        entries: [
          expect.objectContaining({
            category: 'tool',
            source: 'workflow',
            description: 'Code sandbox',
            sourceReference: 'sandbox:e2b:sandbox-1',
          }),
        ],
      })
    )
    expect(dbChainMockFns.execute).toHaveBeenCalledOnce()
    expect(dbChainMockFns.update).toHaveBeenCalled()
  })

  it('terminates and checkpoints a sandbox whose terminal timestamp is missing', async () => {
    await runHandler(
      payload({
        terminationRequestedAt: undefined,
        terminatedAt: undefined,
        outcome: undefined,
        cleanupStatus: 'active',
      })
    )

    expect(mockTerminateById).toHaveBeenCalledWith('sandbox-1')
    expect(context.checkpointPayload).toHaveBeenCalledWith(
      expect.objectContaining({ cleanupStatus: 'terminated', terminatedAt: expect.any(String) })
    )
    expect(mockRecordUsage).toHaveBeenCalledOnce()
  })

  it('propagates transient provider failures so the generic outbox retries', async () => {
    mockTerminateById.mockRejectedValueOnce(new Error('provider unavailable'))

    await expect(
      runHandler(payload({ terminatedAt: undefined, cleanupStatus: 'pending_reconciliation' }))
    ).rejects.toThrow('provider unavailable')
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('uses the same ledger event key when finalization is replayed', async () => {
    await runHandler(payload())
    await runHandler(payload())

    const firstEventKey = mockRecordUsage.mock.calls[0][0].entries[0].eventKey
    const secondEventKey = mockRecordUsage.mock.calls[1][0].entries[0].eventKey
    expect(firstEventKey).toBe(secondEventKey)
  })
})
