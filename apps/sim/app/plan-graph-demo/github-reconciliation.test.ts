import { describe, expect, it } from 'vitest'
import { resolveCheckState, resolveReviewState } from '@/app/plan-graph-demo/github-reconciliation'

describe('GitHub plan reconciliation', () => {
  it('summarizes check runs conservatively', () => {
    expect(resolveCheckState({ total_count: 0, check_runs: [] })).toBe('Pending')
    expect(
      resolveCheckState({
        total_count: 1,
        check_runs: [{ status: 'in_progress', conclusion: null }],
      })
    ).toBe('Running')
    expect(
      resolveCheckState({
        total_count: 2,
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'completed', conclusion: 'skipped' },
        ],
      })
    ).toBe('Passed')
    expect(
      resolveCheckState({
        total_count: 1,
        check_runs: [{ status: 'completed', conclusion: 'failure' }],
      })
    ).toBe('Failed')
  })

  it('uses the latest material review per author', () => {
    expect(
      resolveReviewState([
        {
          id: 1,
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-08-31T00:00:00Z',
          user: { login: 'reviewer' },
        },
        {
          id: 2,
          state: 'APPROVED',
          submitted_at: '2026-08-31T00:01:00Z',
          user: { login: 'reviewer' },
        },
      ])
    ).toBe('Approved')
  })
})
