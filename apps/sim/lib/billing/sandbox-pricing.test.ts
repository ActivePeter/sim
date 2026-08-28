/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { createSandboxPricingSnapshot, priceSandboxUsage } from '@/lib/billing/sandbox-pricing'

const STARTED_AT = new Date('2026-08-27T12:00:00.000Z')
const ONE_HOUR_LATER = new Date('2026-08-27T13:00:00.000Z')

describe('sandbox pricing', () => {
  it.each([
    ['e2b', 0.1656],
    ['daytona', 0.16668],
  ] as const)('prices one hour of the %s Function profile', (provider, expectedRawCost) => {
    const priced = priceSandboxUsage(
      createSandboxPricingSnapshot(provider, 1),
      STARTED_AT,
      ONE_HOUR_LATER,
      ONE_HOUR_LATER
    )

    expect(priced.durationMs).toBe(3_600_000)
    expect(priced.rawCost).toBeCloseTo(expectedRawCost, 10)
    expect(priced.billedCost).toBe(expectedRawCost)
  })

  it('applies the multiplier once and rounds the billed cost to eight decimals', () => {
    const priced = priceSandboxUsage(
      createSandboxPricingSnapshot('e2b', 2.5),
      STARTED_AT,
      new Date(STARTED_AT.getTime() + 1234),
      ONE_HOUR_LATER
    )

    expect(priced.billedCost).toBe(Number.parseFloat((priced.rawCost * 2.5).toFixed(8)))
  })

  it('caps billable duration at the provider expiry', () => {
    const expiresAt = new Date(STARTED_AT.getTime() + 15_000)
    const priced = priceSandboxUsage(
      createSandboxPricingSnapshot('daytona', 1),
      STARTED_AT,
      ONE_HOUR_LATER,
      expiresAt
    )

    expect(priced.durationMs).toBe(15_000)
    expect(priced.sandboxSeconds).toBe(15)
  })
})
