'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge, ChipConfirmModal } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { ReactFlowProvider } from 'reactflow'
import { CanvasEditorFrame } from '@/components/canvas'
import { DEFAULT_DEMO_DAG_ID } from '@/lib/dags/demo-catalog'
import {
  ActivityPanel,
  DagCanvasAdapter,
  NodeInspector,
  type PlanActivity,
  PlanHeader,
} from '@/app/plan-graph-demo/components'
import { useGitHubReconciliation } from '@/app/plan-graph-demo/hooks/use-github-reconciliation'
import { usePersistedDag } from '@/app/plan-graph-demo/hooks/use-persisted-dag'
import {
  addDagDependency,
  addDagItem,
  applyGitHubBindingUpdates,
  type DagItemUpdate,
  getNextDagItemId,
  getNextReadyItem,
  getPlanCounts,
  type PlanDependencyKind,
  removeDagDependency,
  removeDagItem,
  resolvePlanItems,
  updateDagDependencyKind,
  updateDagItem,
} from '@/app/plan-graph-demo/plan-graph-model'

const INITIAL_ACTIVITIES: readonly PlanActivity[] = [
  {
    id: 'activity-self-hosting',
    title: 'Sim self-hosting roadmap initialized',
    detail: 'The graph is backed by a durable workspace file with optimistic concurrency.',
    kind: 'plan',
    time: 'Now',
  },
  {
    id: 'activity-ready',
    title: 'PG-01 is ready to claim',
    detail: 'This MVP branch and its first real pull request are the first execution attempt.',
    kind: 'agent',
    time: 'Now',
  },
]

interface DagDemoProps {
  dagId?: string
  workspaceId?: string
}

interface PendingDeletion {
  id: string
  kind: 'dependency' | 'item'
}

export function DagDemo({ dagId = DEFAULT_DEMO_DAG_ID, workspaceId }: DagDemoProps = {}) {
  const { dag, error, fileId, isLoading, isSaving, reset, updateDag } = usePersistedDag(
    workspaceId,
    dagId
  )
  const githubSync = useGitHubReconciliation()
  const [selectedItemId, setSelectedItemId] = useState('PG-01')
  const [activities, setActivities] = useState<PlanActivity[]>([...INITIAL_ACTIVITIES])
  const [canvasRevision, setCanvasRevision] = useState(0)
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion>()

  const resolvedItems = useMemo(
    () => (dag ? resolvePlanItems(dag.items, dag.dependencies) : []),
    [dag]
  )
  const counts = getPlanCounts(resolvedItems)
  const selectedItem = resolvedItems.find((item) => item.id === selectedItemId) ?? resolvedItems[0]
  const nextReadyItem = dag ? getNextReadyItem(dag.items, dag.dependencies) : undefined

  const prependActivity = useCallback((activity: PlanActivity) => {
    setActivities((current) => [activity, ...current].slice(0, 8))
  }, [])

  function handleAddItem() {
    if (!dag) return
    const itemId = getNextDagItemId(dag.items)
    if (!updateDag((current) => addDagItem(current, itemId))) return
    setSelectedItemId(itemId)
    prependActivity({
      id: generateShortId(),
      title: `${itemId} added to the durable DAG`,
      detail: 'Edit its bindings, then drag a connector to define a dependency.',
      kind: 'plan',
      time: 'Now',
    })
  }

  function handleUpdateItem(itemId: string, update: DagItemUpdate) {
    updateDag((current) => updateDagItem(current, itemId, update))
  }

  function removeItem(itemId: string) {
    if (!dag || dag.items.length <= 1) return
    const nextSelectedItemId = dag.items.find((item) => item.id !== itemId)?.id
    if (!updateDag((current) => removeDagItem(current, itemId))) return
    setSelectedItemId((current) =>
      current === itemId && nextSelectedItemId ? nextSelectedItemId : current
    )
    prependActivity({
      id: generateShortId(),
      title: `${itemId} removed`,
      detail: 'Its position and dependency edges were removed in the same revision.',
      kind: 'plan',
      time: 'Now',
    })
  }

  const handleRemoveItem = useCallback((itemId: string) => {
    setPendingDeletion({ id: itemId, kind: 'item' })
  }, [])

  const handleConnectItems = useCallback(
    (sourceId: string, targetId: string) => {
      if (!dag) return
      const dependency = {
        id: `edge-${generateShortId()}`,
        source: sourceId,
        target: targetId,
        kind: 'requires' as const,
      }
      const next = addDagDependency(dag, dependency)
      const accepted = next !== dag
      if (accepted) updateDag(() => next)
      prependActivity({
        id: generateShortId(),
        title: accepted ? `${sourceId} → ${targetId} connected` : 'Dependency rejected',
        detail: accepted
          ? 'A requires edge was persisted.'
          : 'DAGs reject duplicate, self-referential, and cyclic dependencies.',
        kind: 'plan',
        time: 'Now',
      })
    },
    [dag, prependActivity, updateDag]
  )

  function handleUpdateDependencyKind(dependencyId: string, kind: PlanDependencyKind) {
    updateDag((current) => updateDagDependencyKind(current, dependencyId, kind))
  }

  const handleRemoveDependency = useCallback((dependencyId: string) => {
    setPendingDeletion({ id: dependencyId, kind: 'dependency' })
  }, [])

  function removeDependency(dependencyId: string) {
    const dependency = dag?.dependencies.find((candidate) => candidate.id === dependencyId)
    if (!dependency || !updateDag((current) => removeDagDependency(current, dependencyId))) return
    prependActivity({
      id: generateShortId(),
      title: `${dependency.source} → ${dependency.target} removed`,
      detail: 'The dependency edge was removed from the durable graph.',
      kind: 'plan',
      time: 'Now',
    })
  }

  function confirmDeletion() {
    if (!pendingDeletion) return
    if (pendingDeletion.kind === 'item') removeItem(pendingDeletion.id)
    else removeDependency(pendingDeletion.id)
    setPendingDeletion(undefined)
  }

  const handlePositionsChange = useCallback(
    (positions: NonNullable<typeof dag>['positions']) => {
      updateDag((current) => {
        if (JSON.stringify(current.positions) === JSON.stringify(positions)) return current
        return { ...current, revision: current.revision + 1, positions }
      })
    },
    [updateDag]
  )

  function handleInspectNext() {
    if (nextReadyItem) setSelectedItemId(nextReadyItem.id)
  }

  async function handleGithubSync() {
    if (!dag) return
    try {
      const result = await githubSync.mutateAsync({ document: dag })
      const changed = updateDag((current) =>
        applyGitHubBindingUpdates(current, result.updates, result.syncedAt)
      )
      prependActivity({
        id: generateShortId(),
        title: 'GitHub artifacts reconciled',
        detail: changed
          ? 'Issue, PR, checks, review, and merge projections were persisted.'
          : 'All artifact bindings already matched GitHub.',
        kind: 'review',
        time: 'Now',
      })
    } catch (cause) {
      prependActivity({
        id: generateShortId(),
        title: 'GitHub sync failed',
        detail: getErrorMessage(cause, 'Unknown GitHub reconciliation error'),
        kind: 'review',
        time: 'Now',
      })
    }
  }

  function handleReset() {
    reset()
    setSelectedItemId('PG-01')
    setActivities([...INITIAL_ACTIVITIES])
    setCanvasRevision((current) => current + 1)
  }

  if (isLoading || !dag || !selectedItem) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] text-[var(--text-muted)] text-sm'>
        {error ?? 'Loading durable Plan Graph…'}
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <PlanHeader
        counts={counts}
        fileId={fileId}
        isSaving={isSaving}
        isSyncing={githubSync.isPending}
        lastGithubSyncAt={dag.lastGithubSyncAt}
        name={dag.name}
        nextReadyItemId={nextReadyItem?.id}
        onAddNode={handleAddItem}
        onInspectNext={handleInspectNext}
        onReset={handleReset}
        onSyncGithub={() => void handleGithubSync()}
        repository={dag.repository}
        revision={dag.revision}
      />

      {error && (
        <div className='border-[var(--border)] border-b bg-[var(--surface-2)] px-4 py-2 text-[var(--text-warning)] text-xs'>
          {error}
        </div>
      )}

      <CanvasEditorFrame
        className='min-h-0 flex-1'
        bottomPanel={<ActivityPanel activities={activities} persistent={Boolean(fileId)} />}
        sidePanel={
          <NodeInspector
            dependencies={dag.dependencies}
            item={selectedItem}
            items={resolvedItems}
            onRemoveDependency={handleRemoveDependency}
            onRemoveItem={() => handleRemoveItem(selectedItem.id)}
            onUpdateDependencyKind={handleUpdateDependencyKind}
            onUpdateItem={(update) => handleUpdateItem(selectedItem.id, update)}
            canRemoveItem={dag.items.length > 1}
          />
        }
      >
        <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
          <div className='flex h-10 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b bg-[var(--surface-1)] px-3'>
            <div className='flex items-center gap-3 text-[var(--text-muted)] text-xs'>
              <span className='hidden sm:inline'>PR dependency DAG</span>
              <span className='flex items-center gap-1.5'>
                <span className='h-px w-5 bg-[var(--text-placeholder)]' />
                prerequisite → dependent
              </span>
            </div>
            <Badge variant='gray-secondary' size='sm'>
              Drag nodes · connect handles · select a node to inspect
            </Badge>
          </div>

          <div className='min-h-0 flex-1'>
            <ReactFlowProvider>
              <DagCanvasAdapter
                key={canvasRevision}
                dependencies={dag.dependencies}
                items={dag.items}
                onConnectItems={handleConnectItems}
                onPositionsChange={handlePositionsChange}
                onRemoveDependency={handleRemoveDependency}
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

      <ChipConfirmModal
        open={Boolean(pendingDeletion)}
        onOpenChange={(open) => {
          if (!open) setPendingDeletion(undefined)
        }}
        icon={Trash}
        title={pendingDeletion?.kind === 'dependency' ? 'Remove dependency' : 'Delete DAG node'}
        text={
          pendingDeletion?.kind === 'dependency'
            ? 'Remove this dependency edge from the durable plan?'
            : [
                'Delete ',
                { text: pendingDeletion?.id ?? 'this node', bold: true },
                '? ',
                {
                  text: 'Its position and every connected dependency will be removed.',
                  error: true,
                },
              ]
        }
        confirm={{
          label: pendingDeletion?.kind === 'dependency' ? 'Remove' : 'Delete',
          onClick: confirmDeletion,
        }}
      />
    </div>
  )
}
