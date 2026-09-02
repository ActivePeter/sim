import { describe, expect, it } from 'vitest'
import {
  addDagDependency,
  addDagItem,
  applyGitHubBindingUpdates,
  claimDagItem,
  createDemoDag,
  getBlockingItemIds,
  getMergeBlockingItemIds,
  getNextDagItemId,
  getNextReadyItem,
  type PlanClaimInput,
  type PlanDependency,
  parseDagDocument,
  removeDagDependency,
  removeDagItem,
  removeDagItems,
  resolvePlanItems,
  serializeDagDocument,
  updateDagDependencyKind,
  updateDagItem,
} from '@/app/plan-graph-demo/plan-graph-model'

const CLAIM: PlanClaimInput = {
  agent: 'Codex local',
  attemptId: 'attempt-pg-01-a',
  sessionId: 'session-pg-01-a',
  worktree: '/worktrees/sim-pg-01',
  branch: 'plan/agent-session-prs/pg-01',
  baseSha: 'abc1234',
  claimedAt: '2026-08-31T00:00:00.000Z',
  expiresAt: '2026-08-31T01:00:00.000Z',
  repositoryRoot: '/repos/sim',
}

describe('plan graph model', () => {
  it('models Sim self-hosting as an isolated persisted DAG document', () => {
    const dag = createDemoDag()
    const secondDag = createDemoDag()

    expect(dag).toMatchObject({
      schemaVersion: 1,
      id: 'agent-session-prs',
      kind: 'dag',
      name: 'Sim 自举开发路线',
      repository: 'ActivePeter/sim',
      revision: 1,
    })
    expect(dag.items).not.toBe(secondDag.items)
    expect(dag.dependencies).not.toBe(secondDag.dependencies)
    expect(dag.positions).not.toBe(secondDag.positions)
    expect(dag.sizes).not.toBe(secondDag.sizes)
    expect(dag.items.find((item) => item.id === 'PG-01')).toMatchObject({
      primaryPr: { number: null, state: 'Unopened' },
      interfaces: expect.arrayContaining([
        expect.objectContaining({ name: 'Latest 试用服务' }),
        expect.objectContaining({ name: '固定快照服务' }),
      ]),
    })
    expect(dag.items.find((item) => item.id === 'PG-07')).toMatchObject({
      repository: 'simstudioai/sim',
      lifecycle: 'review',
      primaryPr: {
        number: 7205,
        state: 'Open',
        url: 'https://github.com/simstudioai/sim/pull/7205',
      },
    })
    expect(
      dag.dependencies.some(
        (dependency) => dependency.source === 'PG-07' || dependency.target === 'PG-07'
      )
    ).toBe(false)
  })

  it('round-trips the durable document through its runtime validator', () => {
    const dag = createDemoDag()

    expect(parseDagDocument(serializeDagDocument(dag))).toEqual(dag)
    const { sizes: _sizes, ...legacyDocument } = dag
    expect(parseDagDocument(JSON.stringify(legacyDocument)).sizes).toEqual({})
    expect(() => parseDagDocument('{"schemaVersion":2}')).toThrow()
  })

  it('adds and edits a DAG node with optional artifact bindings', () => {
    const dag = createDemoDag()
    const itemId = getNextDagItemId(dag.items)
    const withItem = addDagItem(dag, itemId)
    const updated = updateDagItem(withItem, itemId, {
      title: 'Editable DAG node',
      localRepositoryPath: '/repos/editable-dag-node',
      issueNumber: 42,
      primaryPrNumber: 84,
    })
    const cleared = updateDagItem(updated, itemId, {
      localRepositoryPath: null,
      issueNumber: null,
      primaryPrNumber: null,
    })

    expect(itemId).toBe('PG-08')
    expect(updated.items.find((item) => item.id === itemId)).toMatchObject({
      title: 'Editable DAG node',
      localRepositoryPath: '/repos/editable-dag-node',
      issue: { number: 42 },
      primaryPr: { number: 84, state: 'Draft' },
    })
    expect(updated.positions[itemId]).toBeDefined()
    expect(cleared.items.find((item) => item.id === itemId)).toMatchObject({
      issue: { number: null, state: 'Unknown' },
      primaryPr: { number: null, state: 'Unopened' },
    })
    expect(cleared.items.find((item) => item.id === itemId)?.localRepositoryPath).toBeUndefined()
  })

  it('adds editable dependencies while preserving the DAG invariant', () => {
    const dag = createDemoDag()
    const dependency: PlanDependency = {
      id: 'edge-new',
      source: 'PG-02',
      target: 'PG-03',
      kind: 'requires',
    }
    const withDependency = addDagDependency(dag, dependency)
    const changedKind = updateDagDependencyKind(withDependency, dependency.id, 'integrate-with')
    const cyclic = addDagDependency(changedKind, {
      id: 'edge-cycle',
      source: 'PG-06',
      target: 'PG-01',
      kind: 'requires',
    })
    const removed = removeDagDependency(changedKind, dependency.id)

    expect(changedKind.dependencies.find((candidate) => candidate.id === dependency.id)?.kind).toBe(
      'integrate-with'
    )
    expect(cyclic).toBe(changedKind)
    expect(removed.dependencies.some((candidate) => candidate.id === dependency.id)).toBe(false)
  })

  it('removes a DAG node together with its position, size, and dependencies', () => {
    const dag = createDemoDag()
    dag.sizes['PG-02'] = { height: 180, width: 320 }
    const next = removeDagItem(dag, 'PG-02')

    expect(next.items.some((item) => item.id === 'PG-02')).toBe(false)
    expect(next.positions['PG-02']).toBeUndefined()
    expect(next.sizes['PG-02']).toBeUndefined()
    expect(
      next.dependencies.some(
        (dependency) => dependency.source === 'PG-02' || dependency.target === 'PG-02'
      )
    ).toBe(false)
  })

  it('removes every selected DAG node in one revision', () => {
    const dag = createDemoDag()
    dag.sizes['PG-02'] = { height: 180, width: 320 }
    dag.sizes['PG-03'] = { height: 200, width: 360 }

    const next = removeDagItems(dag, ['PG-02', 'PG-03'])

    expect(next.revision).toBe(dag.revision + 1)
    expect(next.items.some((item) => item.id === 'PG-02' || item.id === 'PG-03')).toBe(false)
    expect(next.positions['PG-02']).toBeUndefined()
    expect(next.positions['PG-03']).toBeUndefined()
    expect(next.sizes['PG-02']).toBeUndefined()
    expect(next.sizes['PG-03']).toBeUndefined()
    expect(
      next.dependencies.some(
        (dependency) =>
          dependency.source === 'PG-02' ||
          dependency.target === 'PG-02' ||
          dependency.source === 'PG-03' ||
          dependency.target === 'PG-03'
      )
    ).toBe(false)
  })

  it('derives ready and blocked states from completed prerequisites', () => {
    const dag = createDemoDag()
    const resolved = resolvePlanItems(dag.items, dag.dependencies, new Date(CLAIM.claimedAt))

    expect(resolved.find((item) => item.id === 'PG-01')?.resolvedLifecycle).toBe('ready')
    expect(resolved.find((item) => item.id === 'PG-02')?.resolvedLifecycle).toBe('blocked')
    expect(getBlockingItemIds('PG-02', dag.items, dag.dependencies)).toEqual(['PG-01'])
    expect(getNextReadyItem(dag.items, dag.dependencies, new Date(CLAIM.claimedAt))?.id).toBe(
      'PG-01'
    )
  })

  it('claims a ready node once with a fencing token', () => {
    const dag = createDemoDag()
    const claimed = claimDagItem(dag, 'PG-01', CLAIM)
    const racingClaim = claimDagItem(claimed, 'PG-01', { ...CLAIM, agent: 'Claude local' })

    expect(dag.items.find((item) => item.id === 'PG-01')?.lifecycle).toBe('planned')
    expect(claimed.items.find((item) => item.id === 'PG-01')).toMatchObject({
      lifecycle: 'active',
      agent: 'Codex local',
      localRepositoryPath: '/repos/sim',
      execution: {
        attemptId: 'attempt-pg-01-a',
        status: 'running',
        lease: { state: 'active', fencingToken: 1 },
      },
    })
    expect(racingClaim).toBe(claimed)
  })

  it('allows takeover after lease expiry and advances the fencing token', () => {
    const dag = claimDagItem(createDemoDag(), 'PG-01', CLAIM)
    const takeover = claimDagItem(dag, 'PG-01', {
      ...CLAIM,
      agent: 'Claude local',
      attemptId: 'attempt-pg-01-b',
      claimedAt: '2026-08-31T02:00:00.000Z',
      expiresAt: '2026-08-31T03:00:00.000Z',
    })

    expect(takeover.items.find((item) => item.id === 'PG-01')).toMatchObject({
      agent: 'Claude local',
      execution: { attemptId: 'attempt-pg-01-b', lease: { fencingToken: 2 } },
    })
  })

  it('does not claim a blocked node', () => {
    const dag = createDemoDag()

    expect(claimDagItem(dag, 'PG-02', CLAIM)).toBe(dag)
  })

  it('projects a real merged PR and unlocks all fan-out children', () => {
    const claimed = claimDagItem(createDemoDag(), 'PG-01', CLAIM)
    const syncedAt = '2026-08-31T02:00:00.000Z'
    const merged = applyGitHubBindingUpdates(
      claimed,
      [
        {
          itemId: 'PG-01',
          issue: { number: 1, state: 'Closed', url: 'https://github.com/ActivePeter/sim/issues/1' },
          primaryPr: {
            number: 1,
            state: 'Merged',
            checks: 'Passed',
            review: 'Approved',
            headSha: 'def5678',
            syncedAt,
          },
        },
      ],
      syncedAt
    )
    const resolved = resolvePlanItems(merged.items, merged.dependencies)

    expect(merged.items.find((item) => item.id === 'PG-01')).toMatchObject({
      lifecycle: 'done',
      execution: { status: 'completed', lease: { state: 'released' } },
    })
    expect(
      resolved.filter((item) => item.resolvedLifecycle === 'ready').map((item) => item.id)
    ).toEqual(['PG-02', 'PG-03', 'PG-04'])
  })

  it('lets integrate-with start independently but keeps the merge barrier', () => {
    const dag = createDemoDag()
    const doneItems = dag.items.map((item) =>
      ['PG-01', 'PG-02', 'PG-03', 'PG-04'].includes(item.id)
        ? { ...item, lifecycle: 'done' as const }
        : item
    )

    expect(
      resolvePlanItems(doneItems, dag.dependencies).find((item) => item.id === 'PG-06')
        ?.resolvedLifecycle
    ).toBe('ready')
    expect(getMergeBlockingItemIds('PG-06', doneItems, dag.dependencies)).toEqual(['PG-05'])
  })
})
