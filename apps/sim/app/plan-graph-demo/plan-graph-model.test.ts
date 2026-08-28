import { describe, expect, it } from 'vitest'
import {
  addRoadmapDependency,
  addRoadmapItem,
  advancePlanItem,
  createDemoPlanItems,
  createDemoRoadmap,
  getBlockingItemIds,
  getMergeBlockingItemIds,
  getNextReadyItem,
  getNextRoadmapItemId,
  type PlanDependency,
  type PlanItem,
  removeRoadmapDependency,
  removeRoadmapItem,
  resolvePlanItems,
  updateRoadmapDependencyKind,
  updateRoadmapItem,
} from '@/app/plan-graph-demo/plan-graph-model'

describe('plan graph demo model', () => {
  it('models the demo as an isolated roadmap document', () => {
    const roadmap = createDemoRoadmap()
    const secondRoadmap = createDemoRoadmap()

    expect(roadmap).toMatchObject({
      id: 'roadmap-agent-sessions',
      kind: 'roadmap',
      name: 'Agent Roadmap',
      revision: 7,
    })
    expect(roadmap.items).not.toBe(secondRoadmap.items)
    expect(roadmap.dependencies).not.toBe(secondRoadmap.dependencies)
    expect(roadmap.positions).not.toBe(secondRoadmap.positions)
  })

  it('adds and edits a roadmap node with artifact bindings', () => {
    const roadmap = createDemoRoadmap()
    const itemId = getNextRoadmapItemId(roadmap.items)
    const withItem = addRoadmapItem(roadmap, itemId)
    const updated = updateRoadmapItem(withItem, itemId, {
      title: 'Editable roadmap node',
      issueNumber: 42,
      primaryPrNumber: 84,
    })

    expect(itemId).toBe('PG-07')
    expect(updated.items.find((item) => item.id === itemId)).toMatchObject({
      title: 'Editable roadmap node',
      issue: { number: 42 },
      primaryPr: { number: 84 },
    })
    expect(updated.positions[itemId]).toBeDefined()
  })

  it('adds editable dependencies while preserving the DAG invariant', () => {
    const roadmap = createDemoRoadmap()
    const dependency: PlanDependency = {
      id: 'edge-new',
      source: 'PG-05',
      target: 'PG-04',
      kind: 'requires',
    }
    const withDependency = addRoadmapDependency(roadmap, dependency)
    const changedKind = updateRoadmapDependencyKind(withDependency, dependency.id, 'integrate-with')
    const cyclic = addRoadmapDependency(changedKind, {
      id: 'edge-cycle',
      source: 'PG-05',
      target: 'PG-01',
      kind: 'requires',
    })
    const removed = removeRoadmapDependency(changedKind, dependency.id)

    expect(changedKind.dependencies.find((candidate) => candidate.id === dependency.id)?.kind).toBe(
      'integrate-with'
    )
    expect(cyclic).toBe(changedKind)
    expect(removed.dependencies.some((candidate) => candidate.id === dependency.id)).toBe(false)
  })

  it('removes a roadmap node together with its position and dependencies', () => {
    const roadmap = createDemoRoadmap()
    const next = removeRoadmapItem(roadmap, 'PG-02')

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

  it('advances against the roadmap dependency set supplied by a caller', () => {
    const items = createDemoPlanItems()
    const next = advancePlanItem(items, 'PG-03', 'Codex 02', [])

    expect(next.find((item) => item.id === 'PG-03')).toMatchObject({
      lifecycle: 'active',
      agent: 'Codex 02',
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
