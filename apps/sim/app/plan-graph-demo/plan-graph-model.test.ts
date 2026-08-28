import { describe, expect, it } from 'vitest'
import {
  advancePlanItem,
  createDemoPlanItems,
  getBlockingItemIds,
  getMergeBlockingItemIds,
  getNextReadyItem,
  type PlanDependency,
  type PlanItem,
  resolvePlanItems,
} from '@/app/plan-graph-demo/plan-graph-model'

describe('plan graph demo model', () => {
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
