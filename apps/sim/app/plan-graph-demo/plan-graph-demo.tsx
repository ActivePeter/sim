'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import { ReactFlowProvider } from 'reactflow'
import {
  ActivityPanel,
  NodeInspector,
  type PlanActivity,
  PlanCanvas,
  PlanHeader,
  PlanSidebar,
} from '@/app/plan-graph-demo/components'
import {
  advancePlanItem,
  createDemoPlanItems,
  DEMO_AGENTS,
  getMergeBlockingItemIds,
  getNextReadyItem,
  getPlanCounts,
  PLAN_DEPENDENCIES,
  resolvePlanItems,
  resolvePlanLifecycle,
} from '@/app/plan-graph-demo/plan-graph-model'

const INITIAL_ACTIVITIES: readonly PlanActivity[] = [
  {
    id: 'activity-ready',
    title: 'PG-02 is ready to claim',
    detail: 'Session identity contract is merged and graph revision 7 passed validation.',
    kind: 'plan',
    time: 'Now',
  },
  {
    id: 'activity-merged',
    title: 'PR #18 merged',
    detail: 'PG-01 accepted the stable identity and ownership contract at 7b31d6f.',
    kind: 'merge',
    time: '4m',
  },
  {
    id: 'activity-revision',
    title: 'Graph revision 7 published',
    detail: 'Peter added the fan-out from durable store to Queue and Change Set.',
    kind: 'plan',
    time: '8m',
  },
]

export function PlanGraphDemo() {
  const [items, setItems] = useState(createDemoPlanItems)
  const [selectedItemId, setSelectedItemId] = useState('PG-02')
  const [activities, setActivities] = useState<PlanActivity[]>([...INITIAL_ACTIVITIES])
  const [canvasRevision, setCanvasRevision] = useState(0)

  const resolvedItems = useMemo(() => resolvePlanItems(items), [items])
  const counts = useMemo(() => getPlanCounts(resolvedItems), [resolvedItems])
  const selectedItem = resolvedItems.find((item) => item.id === selectedItemId) ?? resolvedItems[0]
  const activeAgents = new Set(
    items
      .filter((item) => item.lifecycle === 'active')
      .map((item) => item.agent)
      .filter((agent): agent is string => Boolean(agent))
  )
  const availableAgent = DEMO_AGENTS.find((agent) => !activeAgents.has(agent))

  const advanceItem = useCallback(
    (itemId: string) => {
      const currentItem = items.find((item) => item.id === itemId)
      if (!currentItem) return

      const lifecycle = resolvePlanLifecycle(currentItem, items)
      const assignedAgent = currentItem.agent ?? availableAgent
      if (lifecycle === 'ready' && !assignedAgent) return
      if (lifecycle === 'review' && getMergeBlockingItemIds(itemId, items).length > 0) return

      const readyBefore = new Set(
        resolvePlanItems(items)
          .filter((item) => item.resolvedLifecycle === 'ready')
          .map((item) => item.id)
      )
      const nextItems = advancePlanItem(items, itemId, assignedAgent ?? DEMO_AGENTS[0])
      const newlyReady = resolvePlanItems(nextItems)
        .filter((item) => item.resolvedLifecycle === 'ready' && !readyBefore.has(item.id))
        .map((item) => item.id)

      let activity: PlanActivity
      if (lifecycle === 'ready') {
        activity = {
          id: generateShortId(),
          title: `${itemId} claimed by ${assignedAgent}`,
          detail:
            'A fenced writer lease, Agent Session, branch, and isolated worktree were created.',
          kind: 'agent',
          time: 'Now',
        }
      } else if (lifecycle === 'active') {
        activity = {
          id: generateShortId(),
          title: `PR #${currentItem.primaryPr.number} entered review`,
          detail: 'Focused checks passed, the writer lease was released, and review is approved.',
          kind: 'review',
          time: 'Now',
        }
      } else {
        activity = {
          id: generateShortId(),
          title: `PR #${currentItem.primaryPr.number} merged`,
          detail:
            newlyReady.length > 0
              ? `Dependency gates reopened. Newly ready: ${newlyReady.join(', ')}.`
              : 'The node is complete and its merged SHA is now authoritative.',
          kind: 'merge',
          time: 'Now',
        }
      }

      setItems(nextItems)
      setActivities((current) => [activity, ...current].slice(0, 8))
    },
    [availableAgent, items]
  )

  const handleClaimNext = useCallback(() => {
    const nextItem = getNextReadyItem(items)
    if (!nextItem || !availableAgent) return
    setSelectedItemId(nextItem.id)
    advanceItem(nextItem.id)
  }, [advanceItem, availableAgent, items])

  const handleReset = useCallback(() => {
    setItems(createDemoPlanItems())
    setSelectedItemId('PG-02')
    setActivities([...INITIAL_ACTIVITIES])
    setCanvasRevision((current) => current + 1)
  }, [])

  if (!selectedItem) return null

  return (
    <div className='flex h-screen min-h-[680px] w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <PlanHeader
        availableAgent={availableAgent}
        counts={counts}
        onClaimNext={handleClaimNext}
        onReset={handleReset}
      />

      <main className='grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_360px]'>
        <PlanSidebar counts={counts} items={resolvedItems} />

        <section className='flex min-h-0 min-w-0 flex-col'>
          <div className='flex h-10 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b bg-[var(--surface-1)] px-3'>
            <div className='flex items-center gap-3 text-[var(--text-muted)] text-xs'>
              <span className='hidden sm:inline'>Development DAG</span>
              <span className='flex items-center gap-1.5'>
                <span className='h-px w-5 bg-[var(--text-placeholder)]' />
                requires
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='h-px w-5 border-[var(--brand-accent)] border-t border-dashed' />
                contract
              </span>
              <span className='hidden items-center gap-1.5 md:flex'>
                <span className='h-px w-5 border-[var(--text-placeholder)] border-t border-dotted' />
                integrate-with
              </span>
            </div>
            <Badge variant='gray-secondary' size='sm'>
              Drag nodes · pan · zoom · select
            </Badge>
          </div>

          <div className='min-h-0 flex-1'>
            <ReactFlowProvider>
              <PlanCanvas
                key={canvasRevision}
                dependencies={PLAN_DEPENDENCIES}
                items={items}
                resolvedItems={resolvedItems}
                selectedItemId={selectedItemId}
                onSelectItem={setSelectedItemId}
              />
            </ReactFlowProvider>
          </div>

          <ActivityPanel activities={activities} />
        </section>

        <NodeInspector
          availableAgent={availableAgent}
          dependencies={PLAN_DEPENDENCIES}
          item={selectedItem}
          items={resolvedItems}
          onAdvance={() => advanceItem(selectedItem.id)}
        />
      </main>
    </div>
  )
}
