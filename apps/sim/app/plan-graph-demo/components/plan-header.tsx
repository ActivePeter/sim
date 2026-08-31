'use client'

import { Badge, Chip, ChipLink } from '@sim/emcn'
import { Plus, RefreshCw, Split, SquareArrowUpRight, Workflow } from '@sim/emcn/icons'
import { useI18n } from '@/lib/i18n'
import type { PlanCounts } from '@/app/plan-graph-demo/plan-graph-model'

interface PlanHeaderProps {
  counts: PlanCounts
  fileId?: string
  isSaving: boolean
  isSyncing: boolean
  lastGithubSyncAt?: string
  name: string
  nextReadyItemId?: string
  onAddNode: () => void
  onInspectNext: () => void
  onReset: () => void
  onSyncGithub: () => void
  repository: string
  revision: number
}

export function PlanHeader({
  counts,
  fileId,
  isSaving,
  isSyncing,
  lastGithubSyncAt,
  name,
  nextReadyItemId,
  onAddNode,
  onInspectNext,
  onReset,
  onSyncGithub,
  repository,
  revision,
}: PlanHeaderProps) {
  const { locale, t } = useI18n()
  const persistenceLabel = isSaving
    ? t('plan.header.saving')
    : fileId
      ? t('plan.header.saved')
      : t('plan.header.localPreview')
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
        <ChipLink
          href='https://github.com/ActivePeter/sim/issues/1'
          target='_blank'
          rel='noreferrer'
          leftIcon={SquareArrowUpRight}
          className='hidden 2xl:inline-flex'
        >
          {t('plan.header.epic', { number: 1 })}
        </ChipLink>
        <Chip leftIcon={RefreshCw} disabled={isSyncing || isSaving} onClick={onSyncGithub}>
          {isSyncing ? t('plan.header.syncing') : t('plan.header.syncGithub')}
        </Chip>
        <Chip leftIcon={Plus} disabled={isSaving} onClick={onAddNode}>
          {t('plan.header.addNode')}
        </Chip>
        <Chip leftIcon={RefreshCw} disabled={isSaving} onClick={onReset}>
          {t('plan.header.reset')}
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
