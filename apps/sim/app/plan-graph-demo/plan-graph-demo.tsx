'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge, ChipConfirmModal, toast } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { ReactFlowProvider } from 'reactflow'
import { CanvasEditorFrame } from '@/components/canvas'
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
} from '@/lib/dags/model'
import { useI18n } from '@/lib/i18n'
import {
  ActivityPanel,
  DagCanvasAdapter,
  NodeInspector,
  PlanHeader,
} from '@/app/plan-graph-demo/components'
import { useGitHubReconciliation } from '@/app/plan-graph-demo/hooks/use-github-reconciliation'
import { usePersistedDag } from '@/app/plan-graph-demo/hooks/use-persisted-dag'

interface DagEditorProps {
  dagId: string
  workspaceId: string
}

type PendingDeletion =
  | { id: string; kind: 'dependency' }
  | { itemIds: readonly string[]; kind: 'items' }

export function DagEditor({ dagId, workspaceId }: DagEditorProps) {
  const { t } = useI18n()
  const { dag, persistedDag, error, isLoading, isMissing, isSaving, updateDag } = usePersistedDag(
    workspaceId,
    dagId
  )
  const githubSync = useGitHubReconciliation()
  const [selectedItemId, setSelectedItemId] = useState<string>()
  const [selectedItemIds, setSelectedItemIds] = useState<readonly string[]>([])
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

  function handleAddItem() {
    if (!dag) return
    const itemId = getNextDagItemId(dag.items)
    if (!updateDag((current) => addDagItem(current, itemId, t('plan.node.untitled')))) return
    setSelectedItemId(itemId)
    setSelectedItemIds([itemId])
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
      else toast.error(t('plan.activity.dependencyRejectedDetail'))
    },
    [dag, t, updateDag]
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
      updateDag((current) => applyGitHubBindingUpdates(current, result.updates, result.syncedAt))
    } catch (cause) {
      toast.error(getErrorMessage(cause, t('plan.activity.unknownGithubError')))
    }
  }

  if (isLoading || !dag) {
    return (
      <div className='flex h-full items-center justify-center bg-[var(--bg)] text-[var(--text-muted)] text-sm'>
        {isMissing ? t('plan.notFound') : (error ?? t('plan.loading'))}
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <PlanHeader
        counts={counts}
        hasError={Boolean(error)}
        isSaving={isSaving}
        isSyncing={githubSync.isPending}
        lastGithubSyncAt={dag.lastGithubSyncAt}
        name={dag.name}
        nextReadyItemId={nextReadyItem?.id}
        onAddNode={handleAddItem}
        onInspectNext={handleInspectNext}
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
        bottomPanel={persistedDag ? <ActivityPanel document={persistedDag} /> : undefined}
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
                dependencies={dag.dependencies}
                onConnectItems={handleConnectItems}
                onItemResize={handleItemResize}
                onPositionsChange={handlePositionsChange}
                onRemoveDependency={handleRemoveDependency}
                onRemoveItems={handleRemoveItems}
                resolvedItems={resolvedItems}
                selectedItemId={selectedItem?.id ?? ''}
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
