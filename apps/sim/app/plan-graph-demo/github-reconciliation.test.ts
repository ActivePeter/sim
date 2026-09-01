import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  reconcileDagWithGitHub,
  resolveCheckState,
  resolveReviewState,
} from '@/app/plan-graph-demo/github-reconciliation'
import { createDemoDag } from '@/app/plan-graph-demo/plan-graph-model'

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    expect(
      resolveCheckState(
        {
          total_count: 1,
          check_runs: [{ status: 'completed', conclusion: 'success' }],
        },
        {
          state: 'failure',
          statuses: [{ context: 'deployment', state: 'failure' }],
        }
      )
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

  it('reconciles a node against its repository override', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/pulls/7205')) {
        return Response.json({
          base: { sha: 'base-sha' },
          draft: false,
          head: { sha: 'head-sha' },
          html_url: 'https://github.com/simstudioai/sim/pull/7205',
          mergeable: false,
          merged_at: null,
          number: 7205,
          state: 'open',
        })
      }
      if (url.endsWith('/commits/head-sha/check-runs')) {
        return Response.json({ check_runs: [], total_count: 0 })
      }
      if (url.endsWith('/commits/head-sha/status')) {
        return Response.json({ state: 'failure', statuses: [{ context: 'ci', state: 'failure' }] })
      }
      if (url.endsWith('/pulls/7205/reviews')) return Response.json([])
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const dag = createDemoDag()
    const codexItem = dag.items.find((item) => item.id === 'PG-07')
    expect(codexItem).toBeDefined()

    const result = await reconcileDagWithGitHub({ ...dag, items: [codexItem!] })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/simstudioai/sim/pulls/7205',
      expect.any(Object)
    )
    expect(result.updates[0]?.primaryPr).toMatchObject({
      number: 7205,
      state: 'Open',
      checks: 'Failed',
      url: 'https://github.com/simstudioai/sim/pull/7205',
    })
  })
})
