'use client'

import { Badge, Chip } from '@sim/emcn'
import { Plus, RefreshCw, Split, Workflow } from '@sim/emcn/icons'
import type { PlanCounts } from '@/lib/dags/model'
import { useI18n } from '@/lib/i18n'

interface PlanHeaderProps {
  counts: PlanCounts
  hasError: boolean
  isSaving: boolean
  isSyncing: boolean
  lastGithubSyncAt?: string
  name: string
  nextReadyItemId?: string
  onAddNode: () => void
  onInspectNext: () => void
  onSyncGithub: () => void
  repository: string
  revision: number
}

export function PlanHeader({
  counts,
  hasError,
  isSaving,
  isSyncing,
  lastGithubSyncAt,
  name,
  nextReadyItemId,
  onAddNode,
  onInspectNext,
  onSyncGithub,
  repository,
  revision,
}: PlanHeaderProps) {
  const { locale, t } = useI18n()
  const persistenceLabel = hasError
    ? t('plan.header.saveFailed')
    : isSaving
      ? t('plan.header.saving')
      : t('plan.header.saved')
  return (
    <header className='flex h-[58px] shrink-0 items-center justify-between gap-4 border-[var(--border)] border-b bg-[var(--surface-1)] px-4'>
      <div className='flex min-w-0 items-center gap-3'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--text-primary)] text-[var(--text-inverse)]'>
          <Split className='size-4' />
        </div>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <h1 className='truncate text-[var(--text-primary)] text-sm'>{name}</h1>
            <Badge variant='purple' size='sm'>
              DAG
            </Badge>
            <Badge variant={isSaving ? 'amber' : 'outline'} size='sm' dot>
              {persistenceLabel}
            </Badge>
          </div>
          <p className='truncate text-[var(--text-muted)] text-xs'>
            {repository} · {t('plan.header.revision', { revision })}
            {lastGithubSyncAt
              ? ` · GitHub ${new Date(lastGithubSyncAt).toLocaleTimeString(locale)}`
              : ''}
          </p>
        </div>
      </div>

      <div className='hidden items-center gap-2 xl:flex'>
        <Badge variant='blue-secondary' size='sm' dot>
          {t('plan.header.ready', { count: counts.ready })}
        </Badge>
        <Badge variant='purple' size='sm' dot>
          {t('plan.header.running', { count: counts.active })}
        </Badge>
        <Badge variant='gray' size='sm' dot>
          {t('plan.header.blocked', { count: counts.blocked })}
        </Badge>
      </div>

      <div className='flex shrink-0 items-center gap-1.5'>
        <Chip leftIcon={RefreshCw} disabled={isSyncing || isSaving} onClick={onSyncGithub}>
          {isSyncing ? t('plan.header.syncing') : t('plan.header.syncGithub')}
        </Chip>
        <Chip leftIcon={Plus} disabled={isSaving} onClick={onAddNode}>
          {t('plan.header.addNode')}
        </Chip>
        <Chip
          variant='primary'
          leftIcon={Workflow}
          disabled={!nextReadyItemId || isSaving}
          onClick={onInspectNext}
        >
          {nextReadyItemId
            ? t('plan.header.inspectNext', { itemId: nextReadyItemId })
            : t('plan.header.noReadyNode')}
        </Chip>
      </div>
    </header>
  )
}
