'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge, ChipConfirmModal } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { ReactFlowProvider } from 'reactflow'
import { CanvasEditorFrame } from '@/components/canvas'
import { DEFAULT_DEMO_DAG_ID } from '@/lib/dags/demo-catalog'
import { useI18n } from '@/lib/i18n'
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
  DEFAULT_PLAN_NODE_SIZE,
  getNextDagItemId,
  getNextReadyItem,
  getPlanCounts,
  type PlanDependencyKind,
  removeDagDependency,
  removeDagItems,
  resolvePlanItems,
  updateDagDependencyKind,
  updateDagItem,
} from '@/app/plan-graph-demo/plan-graph-model'

const INITIAL_ACTIVITIES: readonly PlanActivity[] = [
  {
    id: 'activity-self-hosting',
    title: { key: 'plan.activity.initializedTitle' },
    detail: { key: 'plan.activity.initializedDetail' },
    kind: 'plan',
    time: { key: 'common.now' },
  },
  {
    id: 'activity-ready',
    title: { key: 'plan.activity.readyTitle' },
    detail: { key: 'plan.activity.readyDetail' },
    kind: 'agent',
    time: { key: 'common.now' },
  },
]

interface DagDemoProps {
  dagId?: string
  workspaceId?: string
}

type PendingDeletion =
  | { id: string; kind: 'dependency' }
  | { itemIds: readonly string[]; kind: 'items' }

export function DagDemo({ dagId = DEFAULT_DEMO_DAG_ID, workspaceId }: DagDemoProps = {}) {
  const { t } = useI18n()
  const { dag, error, fileId, isLoading, isSaving, reset, updateDag } = usePersistedDag(
    workspaceId,
    dagId
  )
  const githubSync = useGitHubReconciliation()
  const [selectedItemId, setSelectedItemId] = useState('PG-01')
  const [selectedItemIds, setSelectedItemIds] = useState<readonly string[]>(['PG-01'])
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
  const pendingItemIds = pendingDeletion?.kind === 'items' ? pendingDeletion.itemIds : []
  const pendingItemCount = pendingItemIds.length

  const prependActivity = useCallback((activity: PlanActivity) => {
    setActivities((current) => [activity, ...current].slice(0, 8))
  }, [])

  function handleAddItem() {
    if (!dag) return
    const itemId = getNextDagItemId(dag.items)
    if (!updateDag((current) => addDagItem(current, itemId))) return
    setSelectedItemId(itemId)
    setSelectedItemIds([itemId])
    prependActivity({
      id: generateShortId(),
      title: { key: 'plan.activity.addedTitle', values: { itemId } },
      detail: { key: 'plan.activity.addedDetail' },
      kind: 'plan',
      time: { key: 'common.now' },
    })
  }

  function handleUpdateItem(itemId: string, update: DagItemUpdate) {
    updateDag((current) => updateDagItem(current, itemId, update))
  }

  function removeItems(itemIds: readonly string[]) {
    if (!dag) return
    const requestedItemIds = new Set(itemIds)
    const removedItemIds = dag.items
      .filter((item) => requestedItemIds.has(item.id))
      .map((item) => item.id)
    if (removedItemIds.length === 0) return

    const removedItemIdSet = new Set(removedItemIds)
    const remainingItems = dag.items.filter((item) => !removedItemIdSet.has(item.id))
    if (!updateDag((current) => removeDagItems(current, removedItemIds))) return

    const nextSelectedItemId =
      remainingItems.find((item) => item.id === selectedItemId)?.id ?? remainingItems[0]?.id ?? ''
    setSelectedItemId(nextSelectedItemId)
    setSelectedItemIds(nextSelectedItemId ? [nextSelectedItemId] : [])
    prependActivity({
      id: generateShortId(),
      title: {
        key: 'plan.activity.removedTitle',
        values: { itemId: removedItemIds.join(', ') },
      },
      detail: {
        key:
          removedItemIds.length > 1
            ? 'plan.activity.removedItemsDetail'
            : 'plan.activity.removedItemDetail',
      },
      kind: 'plan',
      time: { key: 'common.now' },
    })
  }

  const handleRemoveItems = useCallback((itemIds: readonly string[]) => {
    const uniqueItemIds = [...new Set(itemIds)]
    if (uniqueItemIds.length > 0) setPendingDeletion({ itemIds: uniqueItemIds, kind: 'items' })
  }, [])

  const handleSelectedItemsChange = useCallback((itemIds: readonly string[]) => {
    setSelectedItemIds((current) => {
      if (
        current.length === itemIds.length &&
        current.every((itemId, index) => itemId === itemIds[index])
      ) {
        return current
      }
      return [...itemIds]
    })
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
        title: accepted
          ? {
              key: 'plan.activity.connectedTitle',
              values: { sourceId, targetId },
            }
          : { key: 'plan.activity.dependencyRejectedTitle' },
        detail: accepted
          ? { key: 'plan.activity.connectedDetail' }
          : { key: 'plan.activity.dependencyRejectedDetail' },
        kind: 'plan',
        time: { key: 'common.now' },
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
      title: {
        key: 'plan.activity.removedTitle',
        values: { itemId: `${dependency.source} → ${dependency.target}` },
      },
      detail: { key: 'plan.activity.removedDependencyDetail' },
      kind: 'plan',
      time: { key: 'common.now' },
    })
  }

  function confirmDeletion() {
    if (!pendingDeletion) return
    if (pendingDeletion.kind === 'items') removeItems(pendingDeletion.itemIds)
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

  const handleItemResize = useCallback(
    (
      itemId: string,
      position: NonNullable<typeof dag>['positions'][string],
      size: NonNullable<typeof dag>['sizes'][string]
    ) => {
      updateDag((current) => {
        const currentPosition = current.positions[itemId]
        const currentSize = current.sizes[itemId] ?? DEFAULT_PLAN_NODE_SIZE
        const positionChanged =
          !currentPosition || currentPosition.x !== position.x || currentPosition.y !== position.y
        const sizeChanged = currentSize.width !== size.width || currentSize.height !== size.height
        if (!positionChanged && !sizeChanged) return current
        return {
          ...current,
          revision: current.revision + 1,
          positions: { ...current.positions, [itemId]: position },
          sizes: { ...current.sizes, [itemId]: size },
        }
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
        title: { key: 'plan.activity.githubReconciledTitle' },
        detail: changed
          ? { key: 'plan.activity.githubChangedDetail' }
          : { key: 'plan.activity.githubUnchangedDetail' },
        kind: 'review',
        time: { key: 'common.now' },
      })
    } catch (cause) {
      prependActivity({
        id: generateShortId(),
        title: { key: 'plan.activity.githubSyncFailedTitle' },
        detail: getErrorMessage(cause, t('plan.activity.unknownGithubError')),
        kind: 'review',
        time: { key: 'common.now' },
      })
    }
  }

  function handleReset() {
    reset()
    setSelectedItemId('PG-01')
    setSelectedItemIds(['PG-01'])
    setActivities([...INITIAL_ACTIVITIES])
    setCanvasRevision((current) => current + 1)
  }

  if (isLoading || !dag) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] text-[var(--text-muted)] text-sm'>
        {error ?? t('plan.loading')}
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
        name={dag.id === DEFAULT_DEMO_DAG_ID ? t('plan.demo.name') : dag.name}
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
          selectedItem ? (
            <NodeInspector
              dependencies={dag.dependencies}
              item={selectedItem}
              items={resolvedItems}
              onRemoveDependency={handleRemoveDependency}
              onRemoveItem={() =>
                handleRemoveItems(
                  selectedItemIds.includes(selectedItem.id) ? selectedItemIds : [selectedItem.id]
                )
              }
              onUpdateDependencyKind={handleUpdateDependencyKind}
              onUpdateItem={(update) => handleUpdateItem(selectedItem.id, update)}
              repository={dag.repository}
              selectedItemCount={
                selectedItemIds.includes(selectedItem.id) ? selectedItemIds.length : 1
              }
            />
          ) : undefined
        }
      >
        <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
          <div className='flex h-10 shrink-0 items-center justify-between gap-3 border-[var(--border)] border-b bg-[var(--surface-1)] px-3'>
            <div className='flex items-center gap-3 text-[var(--text-muted)] text-xs'>
              <span className='hidden sm:inline'>{t('plan.canvas.title')}</span>
              <span className='flex items-center gap-1.5'>
                <span className='h-px w-5 bg-[var(--text-placeholder)]' />
                {t('plan.canvas.direction')}
              </span>
            </div>
            <Badge variant='gray-secondary' size='sm'>
              {t('plan.canvas.instructions')}
            </Badge>
          </div>

          <div className='min-h-0 flex-1'>
            <ReactFlowProvider>
              <DagCanvasAdapter
                key={canvasRevision}
                dependencies={dag.dependencies}
                onConnectItems={handleConnectItems}
                onItemResize={handleItemResize}
                onPositionsChange={handlePositionsChange}
                onRemoveDependency={handleRemoveDependency}
                onRemoveItems={handleRemoveItems}
                resolvedItems={resolvedItems}
                selectedItemId={selectedItemId}
                onSelectItem={setSelectedItemId}
                onSelectedItemsChange={handleSelectedItemsChange}
                positions={dag.positions}
                repository={dag.repository}
                sizes={dag.sizes}
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
        title={
          pendingDeletion?.kind === 'dependency'
            ? t('plan.confirm.removeDependency')
            : pendingItemCount > 1
              ? t('plan.confirm.deleteNodes')
              : t('plan.confirm.deleteNode')
        }
        text={
          pendingDeletion?.kind === 'dependency'
            ? t('plan.confirm.removeDependencyPrompt')
            : pendingItemCount > 1
              ? [
                  t('plan.confirm.deleteSelectionPrompt', { count: pendingItemCount }),
                  { text: pendingItemIds.join(', '), bold: true },
                  ' — ',
                  { text: t('plan.confirm.deleteSelectionDetail'), error: true },
                ]
              : [
                  t('plan.confirm.deletePrompt'),
                  { text: pendingItemIds[0] ?? t('plan.confirm.deleteNode'), bold: true },
                  '? ',
                  {
                    text: t('plan.confirm.deleteDetail'),
                    error: true,
                  },
                ]
        }
        confirm={{
          label:
            pendingDeletion?.kind === 'dependency'
              ? t('plan.confirm.remove')
              : pendingItemCount > 1
                ? t('plan.inspector.deleteSelected', { count: pendingItemCount })
                : t('plan.inspector.delete'),
          onClick: confirmDeletion,
        }}
      />
    </div>
  )
}
