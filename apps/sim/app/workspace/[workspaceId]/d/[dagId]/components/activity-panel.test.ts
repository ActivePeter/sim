/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn/icons', () => ({
  BrainCircuit: () => null,
  CircleCheck: () => null,
  Clock: () => null,
  Workflow: () => null,
}))
vi.mock('@/lib/i18n', () => ({ useI18n: vi.fn() }))

import { createTestDag } from '@/lib/dags/model.test-fixtures'
import { getPersistedPlanActivities } from '@/app/workspace/[workspaceId]/d/[dagId]/components/activity-panel'

describe('persisted DAG activity projection', () => {
  it('does not invent ready, initialization, or execution events for planned nodes', () => {
    expect(getPersistedPlanActivities(createTestDag())).toEqual([])
  })
  it('renders only recorded attempts and reconciled PR facts at their stored timestamps', () => {
    const document = createTestDag()
    const node = document.items[0]
    node.primaryPr = {
      ...node.primaryPr,
      number: 84,
      state: 'Merged',
      syncedAt: '2026-09-01T00:00:00.000Z',
    }
    const activities = getPersistedPlanActivities(document)
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      kind: 'merge',
      time: node.primaryPr.syncedAt,
      title: { values: { itemId: node.id, number: 84 } },
    })
  })
})
