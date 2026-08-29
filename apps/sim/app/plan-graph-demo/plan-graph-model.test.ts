import { describe, expect, it } from 'vitest'
import {
  addDagDependency,
  addDagItem,
  advancePlanItem,
  createDemoDag,
  createDemoPlanItems,
  getBlockingItemIds,
  getMergeBlockingItemIds,
  getNextDagItemId,
  getNextReadyItem,
  type PlanDependency,
  type PlanItem,
  removeDagDependency,
  removeDagItem,
  resolvePlanItems,
  updateDagDependencyKind,
  updateDagItem,
} from '@/app/plan-graph-demo/plan-graph-model'

describe('plan graph demo model', () => {
  it('models the demo as an isolated DAG document', () => {
    const dag = createDemoDag()
    const secondDag = createDemoDag()

    expect(dag).toMatchObject({
      id: 'agent-session-prs',
      kind: 'dag',
      name: 'Agent session PR rollout',
      revision: 7,
    })
    expect(dag.items).not.toBe(secondDag.items)
    expect(dag.dependencies).not.toBe(secondDag.dependencies)
    expect(dag.positions).not.toBe(secondDag.positions)
  })

  it('adds and edits a DAG node with artifact bindings', () => {
    const dag = createDemoDag()
    const itemId = getNextDagItemId(dag.items)
    const withItem = addDagItem(dag, itemId)
    const updated = updateDagItem(withItem, itemId, {
      title: 'Editable DAG node',
      issueNumber: 42,
      primaryPrNumber: 84,
    })
    const cleared = updateDagItem(updated, itemId, { primaryPrNumber: null })

    expect(itemId).toBe('PG-07')
    expect(withItem.items.find((item) => item.id === itemId)?.primaryPr).toMatchObject({
      number: null,
      state: 'Unopened',
    })
    expect(updated.items.find((item) => item.id === itemId)).toMatchObject({
      title: 'Editable DAG node',
      issue: { number: 42 },
      primaryPr: { number: 84, state: 'Draft' },
    })
    expect(updated.positions[itemId]).toBeDefined()
    expect(cleared.items.find((item) => item.id === itemId)?.primaryPr).toMatchObject({
      number: null,
      state: 'Unopened',
    })
  })

  it('adds editable dependencies while preserving the DAG invariant', () => {
    const dag = createDemoDag()
    const dependency: PlanDependency = {
      id: 'edge-new',
      source: 'PG-05',
      target: 'PG-04',
      kind: 'requires',
    }
    const withDependency = addDagDependency(dag, dependency)
    const changedKind = updateDagDependencyKind(withDependency, dependency.id, 'integrate-with')
    const cyclic = addDagDependency(changedKind, {
      id: 'edge-cycle',
      source: 'PG-05',
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

  it('removes a DAG node together with its position and dependencies', () => {
    const dag = createDemoDag()
    const next = removeDagItem(dag, 'PG-02')

    expect(next.items.some((item) => item.id === 'PG-02')).toBe(false)
    expect(next.positions['PG-02']).toBeUndefined()
    expect(
      next.dependencies.some(
        (dependency) => dependency.source === 'PG-02' || dependency.target === 'PG-02'
      )
    ).toBe(false)
  })

  it('derives ready and blocked states from completed prerequisites', () => {
    const items = createDemoPlanItems()
    const resolved = resolvePlanItems(items)

    expect(resolved.find((item) => item.id === 'PG-02')?.resolvedLifecycle).toBe('ready')
    expect(resolved.find((item) => item.id === 'PG-03')?.resolvedLifecycle).toBe('blocked')
    expect(getBlockingItemIds('PG-03', items)).toEqual(['PG-02'])
  })

  it('unlocks both fan-out nodes after their prerequisite is done', () => {
    let items = createDemoPlanItems()
    items = advancePlanItem(items, 'PG-02', 'Codex 01')
    items = advancePlanItem(items, 'PG-02', 'Codex 01')
    items = advancePlanItem(items, 'PG-02', 'Codex 01')

    const resolved = resolvePlanItems(items)

    expect(resolved.find((item) => item.id === 'PG-03')?.resolvedLifecycle).toBe('ready')
    expect(resolved.find((item) => item.id === 'PG-04')?.resolvedLifecycle).toBe('ready')
  })

  it('claims a ready node without mutating the previous snapshot', () => {
    const items = createDemoPlanItems()
    const next = advancePlanItem(items, 'PG-02', 'Claude 01')

    expect(items.find((item) => item.id === 'PG-02')?.lifecycle).toBe('planned')
    expect(next.find((item) => item.id === 'PG-02')).toMatchObject({
      lifecycle: 'active',
      agent: 'Claude 01',
      execution: {
        lease: 'active',
        status: 'running',
      },
      primaryPr: {
        state: 'Draft',
        checks: 'Running',
      },
    })
  })

  it('does not advance a blocked node', () => {
    const items = createDemoPlanItems()
    const next = advancePlanItem(items, 'PG-03', 'Codex 02')

    expect(next.find((item) => item.id === 'PG-03')?.lifecycle).toBe('planned')
    expect(next.find((item) => item.id === 'PG-03')?.agent).toBeUndefined()
  })

  it('supports dependency policies supplied by a caller', () => {
    const items: PlanItem[] = createDemoPlanItems().slice(0, 2)
    const dependencies: PlanDependency[] = [
      { id: 'custom', source: 'PG-02', target: 'PG-01', kind: 'requires' },
    ]

    expect(getBlockingItemIds('PG-01', items, dependencies)).toEqual(['PG-02'])
  })

  it('advances against the DAG dependency set supplied by a caller', () => {
    const items = createDemoPlanItems()
    const next = advancePlanItem(items, 'PG-03', 'Codex 02', [])

    expect(next.find((item) => item.id === 'PG-03')).toMatchObject({
      lifecycle: 'active',
      agent: 'Codex 02',
      primaryPr: {
        number: 23,
        state: 'Draft',
      },
    })
  })

  it('allows an integration consumer to start but blocks its merge', () => {
    let items = createDemoPlanItems()
    for (let transition = 0; transition < 3; transition += 1) {
      items = advancePlanItem(items, 'PG-02', 'Codex 01')
    }
    for (let transition = 0; transition < 3; transition += 1) {
      items = advancePlanItem(items, 'PG-03', 'Codex 01')
    }

    expect(resolvePlanItems(items).find((item) => item.id === 'PG-06')?.resolvedLifecycle).toBe(
      'ready'
    )
    expect(getMergeBlockingItemIds('PG-06', items)).toEqual(['PG-04'])

    items = advancePlanItem(items, 'PG-06', 'Codex 02')
    items = advancePlanItem(items, 'PG-06', 'Codex 02')
    items = advancePlanItem(items, 'PG-06', 'Codex 02')

    expect(items.find((item) => item.id === 'PG-06')?.lifecycle).toBe('review')
  })

  it('returns the first node that is actually ready', () => {
    const items = createDemoPlanItems()

    expect(getNextReadyItem(items)?.id).toBe('PG-02')
  })
})
