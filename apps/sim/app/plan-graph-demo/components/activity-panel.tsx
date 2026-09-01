'use client'

import { BrainCircuit, CircleCheck, Clock, Workflow } from '@sim/emcn/icons'
import { type TranslationKey, type TranslationValues, useI18n } from '@/lib/i18n'

export interface PlanActivityMessage {
  key: TranslationKey
  values?: TranslationValues
}

export type PlanActivityText = string | PlanActivityMessage

export interface PlanActivity {
  id: string
  detail: PlanActivityText
  kind: 'agent' | 'merge' | 'plan' | 'review'
  time: PlanActivityText
  title: PlanActivityText
}

const ACTIVITY_ICONS = {
  agent: BrainCircuit,
  merge: CircleCheck,
  plan: Workflow,
  review: Clock,
} as const

interface ActivityPanelProps {
  activities: readonly PlanActivity[]
  persistent: boolean
}

export function ActivityPanel({ activities, persistent }: ActivityPanelProps) {
  const { t } = useI18n()
  const renderText = (text: PlanActivityText) =>
    typeof text === 'string' ? text : t(text.key, text.values)

  return (
    <section className='h-[148px] shrink-0 border-[var(--border)] border-t bg-[var(--surface-1)]'>
      <div className='flex h-9 items-center justify-between border-[var(--border)] border-b px-3'>
        <h2 className='text-[var(--text-primary)] text-xs'>{t('plan.activity.panelTitle')}</h2>
        <span className='text-[10px] text-[var(--text-muted)]'>
          {persistent ? t('plan.projection.durable') : t('plan.projection.local')}
        </span>
      </div>
      <div className='grid h-[111px] grid-cols-1 divide-y divide-[var(--border)] overflow-y-auto md:grid-cols-3 md:divide-x md:divide-y-0'>
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
                    {renderText(activity.title)}
                  </p>
                  <span className='shrink-0 text-[10px] text-[var(--text-muted)]'>
                    {renderText(activity.time)}
                  </span>
                </div>
                <p className='mt-1 line-clamp-2 text-[var(--text-muted)] text-xs leading-4'>
                  {renderText(activity.detail)}
                </p>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
