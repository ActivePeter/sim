'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import { ReactFlowProvider } from 'reactflow'
import { CanvasEditorFrame } from '@/components/canvas'
import {
  ActivityPanel,
  DagCanvasAdapter,
  NodeInspector,
  type PlanActivity,
  PlanHeader,
} from '@/app/plan-graph-demo/components'
import {
  addDagDependency,
  addDagItem,
  advancePlanItem,
  createDemoDag,
  type DagItemUpdate,
  DEMO_AGENTS,
  getMergeBlockingItemIds,
  getNextDagItemId,
  getNextReadyItem,
  getPlanCounts,
  type PlanDependencyKind,
  removeDagDependency,
  removeDagItem,
  resolvePlanItems,
  resolvePlanLifecycle,
  updateDagDependencyKind,
  updateDagItem,
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

interface DagDemoProps {
  dagId?: string
}

export function DagDemo({ dagId }: DagDemoProps = {}) {
  const [dag, setDag] = useState(() => createDemoDag(dagId))
  const [selectedItemId, setSelectedItemId] = useState('PG-02')
  const [activities, setActivities] = useState<PlanActivity[]>([...INITIAL_ACTIVITIES])
  const [canvasRevision, setCanvasRevision] = useState(0)

  const items = dag.items
  const resolvedItems = useMemo(
    () => resolvePlanItems(items, dag.dependencies),
    [items, dag.dependencies]
  )
  const counts = useMemo(() => getPlanCounts(resolvedItems), [resolvedItems])
  const selectedItem = resolvedItems.find((item) => item.id === selectedItemId) ?? resolvedItems[0]
  const activeAgents = new Set(
    items
      .filter((item) => item.lifecycle === 'active')
      .map((item) => item.agent)
      .filter((agent): agent is string => Boolean(agent))
  )
  const availableAgent = DEMO_AGENTS.find((agent) => !activeAgents.has(agent))

  const handleAddItem = useCallback(() => {
    const itemId = getNextDagItemId(items)
    setDag((current) => addDagItem(current, itemId))
    setSelectedItemId(itemId)
    setActivities((current) =>
      [
        {
          id: generateShortId(),
          title: `${itemId} added to the DAG`,
          detail:
            'Edit its bindings in the inspector, then drag a connector to define a dependency.',
          kind: 'plan' as const,
          time: 'Now',
        },
        ...current,
      ].slice(0, 8)
    )
  }, [items])

  const handleUpdateItem = useCallback((itemId: string, update: DagItemUpdate) => {
    setDag((current) => updateDagItem(current, itemId, update))
  }, [])

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      if (items.length <= 1) return
      const nextSelectedItemId = items.find((item) => item.id !== itemId)?.id
      setDag((current) => removeDagItem(current, itemId))
      if (selectedItemId === itemId && nextSelectedItemId) {
        setSelectedItemId(nextSelectedItemId)
      }
      setActivities((current) =>
        [
          {
            id: generateShortId(),
            title: `${itemId} removed`,
            detail: 'Its position and connected dependency edges were removed atomically.',
            kind: 'plan' as const,
            time: 'Now',
          },
          ...current,
        ].slice(0, 8)
      )
    },
    [items, selectedItemId]
  )

  const handleConnectItems = useCallback(
    (sourceId: string, targetId: string) => {
      const dependency = {
        id: `edge-${generateShortId()}`,
        source: sourceId,
        target: targetId,
        kind: 'requires' as const,
      }
      const nextDag = addDagDependency(dag, dependency)
      const accepted = nextDag !== dag
      if (accepted) setDag(nextDag)
      setActivities((current) =>
        [
          {
            id: generateShortId(),
            title: accepted ? `${sourceId} → ${targetId} connected` : 'Dependency rejected',
            detail: accepted
              ? 'A requires edge was added. Select the target node to change its policy.'
              : 'DAGs reject duplicate, self-referential, and cyclic dependencies.',
            kind: 'plan' as const,
            time: 'Now',
          },
          ...current,
        ].slice(0, 8)
      )
    },
    [dag]
  )

  const handleUpdateDependencyKind = useCallback(
    (dependencyId: string, kind: PlanDependencyKind) => {
      setDag((current) => updateDagDependencyKind(current, dependencyId, kind))
    },
    []
  )

  const handleRemoveDependency = useCallback((dependencyId: string) => {
    setDag((current) => removeDagDependency(current, dependencyId))
  }, [])

  const handlePositionsChange = useCallback((positions: typeof dag.positions) => {
    setDag((current) => ({ ...current, positions }))
  }, [])

  const advanceItem = useCallback(
    (itemId: string) => {
      const currentItem = items.find((item) => item.id === itemId)
      if (!currentItem) return

      const lifecycle = resolvePlanLifecycle(currentItem, items, dag.dependencies)
      const assignedAgent = currentItem.agent ?? availableAgent
      const pullRequestLabel =
        currentItem.primaryPr.number === null
          ? 'Planned pull request'
          : `PR #${currentItem.primaryPr.number}`
      if (lifecycle === 'ready' && !assignedAgent) return
      if (
        lifecycle === 'review' &&
        getMergeBlockingItemIds(itemId, items, dag.dependencies).length > 0
      ) {
        return
      }

      const readyBefore = new Set(
        resolvePlanItems(items, dag.dependencies)
          .filter((item) => item.resolvedLifecycle === 'ready')
          .map((item) => item.id)
      )
      const nextItems = advancePlanItem(
        items,
        itemId,
        assignedAgent ?? DEMO_AGENTS[0],
        dag.dependencies
      )
      const newlyReady = resolvePlanItems(nextItems, dag.dependencies)
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
          title: `${pullRequestLabel} entered review`,
          detail: 'Focused checks passed, the writer lease was released, and review is approved.',
          kind: 'review',
          time: 'Now',
        }
      } else {
        activity = {
          id: generateShortId(),
          title: `${pullRequestLabel} merged`,
          detail:
            newlyReady.length > 0
              ? `Dependency gates reopened. Newly ready: ${newlyReady.join(', ')}.`
              : 'The node is complete and its merged SHA is now authoritative.',
          kind: 'merge',
          time: 'Now',
        }
      }

      setDag((current) => ({ ...current, items: nextItems }))
      setActivities((current) => [activity, ...current].slice(0, 8))
    },
    [availableAgent, items, dag.dependencies]
  )

  const handleClaimNext = useCallback(() => {
    const nextItem = getNextReadyItem(items, dag.dependencies)
    if (!nextItem || !availableAgent) return
    setSelectedItemId(nextItem.id)
    advanceItem(nextItem.id)
  }, [advanceItem, availableAgent, items, dag.dependencies])

  const handleReset = useCallback(() => {
    setDag(createDemoDag(dagId))
    setSelectedItemId('PG-02')
    setActivities([...INITIAL_ACTIVITIES])
    setCanvasRevision((current) => current + 1)
  }, [dagId])

  if (!selectedItem) return null

  return (
    <div className='flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <PlanHeader
        availableAgent={availableAgent}
        counts={counts}
        name={dag.name}
        onAddNode={handleAddItem}
        onClaimNext={handleClaimNext}
        onReset={handleReset}
        repository={dag.repository}
        revision={dag.revision}
      />

      <CanvasEditorFrame
        className='min-h-0 flex-1'
        bottomPanel={<ActivityPanel activities={activities} />}
        sidePanel={
          <NodeInspector
            availableAgent={availableAgent}
            dependencies={dag.dependencies}
            item={selectedItem}
            items={resolvedItems}
            onAdvance={() => advanceItem(selectedItem.id)}
            onRemoveDependency={handleRemoveDependency}
            onRemoveItem={() => handleRemoveItem(selectedItem.id)}
            onUpdateDependencyKind={handleUpdateDependencyKind}
            onUpdateItem={(update) => handleUpdateItem(selectedItem.id, update)}
            canRemoveItem={items.length > 1}
          />
        }
      >
        <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
          <div className='flex h-10 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b bg-[var(--surface-1)] px-3'>
            <div className='flex items-center gap-3 text-[var(--text-muted)] text-xs'>
              <span className='hidden sm:inline'>PR dependency DAG</span>
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
              Drag nodes · connect right handle to left handle · edit in inspector
            </Badge>
          </div>

          <div className='min-h-0 flex-1'>
            <ReactFlowProvider>
              <DagCanvasAdapter
                key={canvasRevision}
                dependencies={dag.dependencies}
                items={items}
                onAdvanceItem={advanceItem}
                onConnectItems={handleConnectItems}
                onPositionsChange={handlePositionsChange}
                onRemoveItem={handleRemoveItem}
                resolvedItems={resolvedItems}
                selectedItemId={selectedItemId}
                onSelectItem={setSelectedItemId}
                positions={dag.positions}
                repository={dag.repository}
              />
            </ReactFlowProvider>
          </div>
        </section>
      </CanvasEditorFrame>
    </div>
  )
}
