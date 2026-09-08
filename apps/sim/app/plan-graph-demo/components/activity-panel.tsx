'use client'

import { BrainCircuit, CircleCheck, Clock, Workflow } from '@sim/emcn/icons'
import type { DagDocument } from '@/lib/dags/model'
import { type TranslationKey, type TranslationValues, useI18n } from '@/lib/i18n'

interface PlanActivityMessage {
  key: TranslationKey
  values?: TranslationValues
}
export interface PlanActivity {
  id: string
  detail: string
  kind: 'agent' | 'merge' | 'plan' | 'review'
  time: string
  title: PlanActivityMessage
}

const ACTIVITY_ICONS = {
  agent: BrainCircuit,
  merge: CircleCheck,
  plan: Workflow,
  review: Clock,
} as const

interface ActivityPanelProps {
  document: DagDocument
}

/** Projects recorded attempts and reconciled GitHub facts; never invents an initial activity. */
export function getPersistedPlanActivities(document: DagDocument): PlanActivity[] {
  const activities: PlanActivity[] = []
  for (const item of document.items) {
    if (item.execution) {
      activities.push({
        id: item.execution.attemptId,
        title: { key: 'plan.activity.attemptTitle', values: { itemId: item.id } },
        detail: `${item.title} · ${item.execution.branch} · ${item.execution.status}`,
        kind: 'agent',
        time: item.execution.lease.claimedAt,
      })
    }
    if (item.primaryPr.number !== null && item.primaryPr.syncedAt) {
      activities.push({
        id: `pr-${item.id}`,
        title: {
          key: 'plan.activity.prTitle',
          values: { itemId: item.id, number: item.primaryPr.number },
        },
        detail: `${item.title} · ${item.primaryPr.state} · ${item.primaryPr.checks}`,
        kind: item.primaryPr.state === 'Merged' ? 'merge' : 'review',
        time: item.primaryPr.syncedAt,
      })
    }
  }
  return activities.sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
}

export function ActivityPanel({ document }: ActivityPanelProps) {
  const { locale, t } = useI18n()
  const activities = getPersistedPlanActivities(document)
  return (
    <section className='h-[148px] shrink-0 border-[var(--border)] border-t bg-[var(--surface-1)]'>
      <div className='flex h-9 items-center justify-between border-[var(--border)] border-b px-3'>
        <h2 className='text-[var(--text-primary)] text-xs'>{t('plan.activity.panelTitle')}</h2>
        <span className='text-[10px] text-[var(--text-muted)]'>
          {t('plan.projection.database')}
        </span>
      </div>
      <div className='grid h-[111px] grid-cols-1 divide-y divide-[var(--border)] overflow-y-auto md:grid-cols-3 md:divide-x md:divide-y-0'>
        {activities.length === 0 && (
          <p className='px-3 py-3 text-[var(--text-muted)] text-xs'>{t('plan.activity.empty')}</p>
        )}
        {activities.slice(0, 3).map((activity) => {
          const Icon = ACTIVITY_ICONS[activity.kind]
          return (
            <article key={activity.id} className='flex min-w-0 gap-2.5 px-3 py-3'>
              <div className='mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--surface-4)]'>
                <Icon className='size-3 text-[var(--text-icon)]' />
              </div>
              <div className='min-w-0'>
                <div className='flex items-center gap-2'>
                  <p className='truncate text-[var(--text-body)] text-xs'>
                    {t(activity.title.key, activity.title.values)}
                  </p>
                  <time
                    dateTime={activity.time}
                    className='shrink-0 text-[10px] text-[var(--text-muted)]'
                  >
                    {new Date(activity.time).toLocaleString(locale)}
                  </time>
                </div>
                <p className='mt-1 line-clamp-2 text-[var(--text-muted)] text-xs leading-4'>
                  {activity.detail}
                </p>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
