import { getCostMultiplier } from '@/lib/core/config/env-flags'
import {
  FUNCTION_DAYTONA_DISK_GB,
  FUNCTION_SANDBOX_CPU_COUNT,
  FUNCTION_SANDBOX_MEMORY_GB,
} from '@/lib/execution/remote-sandbox/function-resources'
import type { SandboxProviderId } from '@/lib/execution/remote-sandbox/types'

const PRICING_VERIFIED_AT = '2026-08-27' as const
const E2B_CPU_USD_PER_VCPU_SECOND = 0.000014
const E2B_MEMORY_USD_PER_GIB_SECOND = 0.0000045
const DAYTONA_CPU_USD_PER_VCPU_SECOND = 0.0504 / 3600
const DAYTONA_MEMORY_USD_PER_GIB_SECOND = 0.0162 / 3600
const DAYTONA_DISK_USD_PER_GIB_SECOND = 0.000108 / 3600

export interface SandboxResourceProfile {
  vcpu: number
  memoryGiB: number
  diskGiB: number
}

export interface SandboxUnitRates {
  cpuUsdPerVcpuSecond: number
  memoryUsdPerGiBSecond: number
  diskUsdPerGiBSecond: number
}

export interface SandboxPricingSnapshot {
  version: 1
  provider: SandboxProviderId
  verifiedAt: typeof PRICING_VERIFIED_AT
  multiplier: number
  resources: SandboxResourceProfile
  rates: SandboxUnitRates
}

export interface PricedSandboxUsage {
  durationMs: number
  sandboxSeconds: number
  vcpuSeconds: number
  memoryGiBSeconds: number
  diskGiBSeconds: number
  rawCost: number
  billedCost: number
}

const PRICING_BY_PROVIDER: Record<
  SandboxProviderId,
  Pick<SandboxPricingSnapshot, 'resources' | 'rates'>
> = {
  e2b: {
    resources: {
      vcpu: FUNCTION_SANDBOX_CPU_COUNT,
      memoryGiB: FUNCTION_SANDBOX_MEMORY_GB,
      diskGiB: 0,
    },
    rates: {
      cpuUsdPerVcpuSecond: E2B_CPU_USD_PER_VCPU_SECOND,
      memoryUsdPerGiBSecond: E2B_MEMORY_USD_PER_GIB_SECOND,
      diskUsdPerGiBSecond: 0,
    },
  },
  daytona: {
    resources: {
      vcpu: FUNCTION_SANDBOX_CPU_COUNT,
      memoryGiB: FUNCTION_SANDBOX_MEMORY_GB,
      diskGiB: FUNCTION_DAYTONA_DISK_GB,
    },
    rates: {
      cpuUsdPerVcpuSecond: DAYTONA_CPU_USD_PER_VCPU_SECOND,
      memoryUsdPerGiBSecond: DAYTONA_MEMORY_USD_PER_GIB_SECOND,
      diskUsdPerGiBSecond: DAYTONA_DISK_USD_PER_GIB_SECOND,
    },
  },
}

function roundCost(value: number): number {
  return Number.parseFloat(value.toFixed(8))
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Sandbox pricing ${field} must be a finite non-negative number`)
  }
}

export function createSandboxPricingSnapshot(
  provider: SandboxProviderId,
  multiplier = getCostMultiplier()
): SandboxPricingSnapshot {
  assertFiniteNonNegative(multiplier, 'multiplier')
  const pricing = PRICING_BY_PROVIDER[provider]
  return {
    version: 1,
    provider,
    verifiedAt: PRICING_VERIFIED_AT,
    multiplier,
    resources: { ...pricing.resources },
    rates: { ...pricing.rates },
  }
}

export function assertSandboxPricingSnapshot(value: unknown): SandboxPricingSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Sandbox pricing snapshot must be an object')
  }
  const snapshot = value as Partial<SandboxPricingSnapshot>
  if (snapshot.version !== 1 || (snapshot.provider !== 'e2b' && snapshot.provider !== 'daytona')) {
    throw new Error('Sandbox pricing snapshot version or provider is invalid')
  }
  if (snapshot.verifiedAt !== PRICING_VERIFIED_AT) {
    throw new Error('Sandbox pricing snapshot verification date is invalid')
  }
  if (!snapshot.resources || !snapshot.rates) {
    throw new Error('Sandbox pricing snapshot resources and rates are required')
  }
  assertFiniteNonNegative(snapshot.multiplier ?? Number.NaN, 'multiplier')
  assertFiniteNonNegative(snapshot.resources.vcpu, 'resources.vcpu')
  assertFiniteNonNegative(snapshot.resources.memoryGiB, 'resources.memoryGiB')
  assertFiniteNonNegative(snapshot.resources.diskGiB, 'resources.diskGiB')
  assertFiniteNonNegative(snapshot.rates.cpuUsdPerVcpuSecond, 'rates.cpuUsdPerVcpuSecond')
  assertFiniteNonNegative(snapshot.rates.memoryUsdPerGiBSecond, 'rates.memoryUsdPerGiBSecond')
  assertFiniteNonNegative(snapshot.rates.diskUsdPerGiBSecond, 'rates.diskUsdPerGiBSecond')
  return snapshot as SandboxPricingSnapshot
}

export function priceSandboxUsage(
  pricingValue: SandboxPricingSnapshot,
  startedAt: Date,
  terminatedAt: Date,
  expiresAt: Date
): PricedSandboxUsage {
  const pricing = assertSandboxPricingSnapshot(pricingValue)
  const effectiveEndMs = Math.min(terminatedAt.getTime(), expiresAt.getTime())
  const durationMs = Math.max(0, effectiveEndMs - startedAt.getTime())
  const sandboxSeconds = durationMs / 1000
  const vcpuSeconds = sandboxSeconds * pricing.resources.vcpu
  const memoryGiBSeconds = sandboxSeconds * pricing.resources.memoryGiB
  const diskGiBSeconds = sandboxSeconds * pricing.resources.diskGiB
  const rawCost =
    vcpuSeconds * pricing.rates.cpuUsdPerVcpuSecond +
    memoryGiBSeconds * pricing.rates.memoryUsdPerGiBSecond +
    diskGiBSeconds * pricing.rates.diskUsdPerGiBSecond

  return {
    durationMs,
    sandboxSeconds,
    vcpuSeconds,
    memoryGiBSeconds,
    diskGiBSeconds,
    rawCost,
    billedCost: roundCost(rawCost * pricing.multiplier),
  }
}
