'use client'

import { Button, cn, Tooltip } from '@sim/emcn'
import { Task, Trash, Workflow } from '@sim/emcn/icons'
import {
  SubBlockRowView,
  WORKFLOW_ACTION_BUTTON_CLASSNAME,
  WORKFLOW_FIRST_SWELL_ACTION_BUTTON_CLASSNAME,
  WORKFLOW_LAST_SWELL_ACTION_BUTTON_CLASSNAME,
  WORKFLOW_SWELL_ACTION_BUTTON_CLASSNAME,
  WorkflowActionBarView,
  WorkflowBlockView,
} from '@sim/workflow-renderer'
import type { NodeProps } from 'reactflow'
import { type TranslationFunction, type TranslationKey, useI18n } from '@/lib/i18n'
import type { PlanLifecycle, ResolvedPlanItem } from '@/app/plan-graph-demo/plan-graph-model'

export interface PlanNodeData {
  canRemove: boolean
  issueUrl?: string
  item: ResolvedPlanItem
  onRemove: () => void
  onSelect: () => void
  pullRequestUrl?: string
  wouldCreateConnectionCycle: (source: string, target: string) => boolean
}

const STATUS_LABEL_KEYS = {
  active: 'plan.status.running',
  blocked: 'plan.status.blocked',
  done: 'plan.status.merged',
  planned: 'plan.status.planned',
  ready: 'plan.status.readyToClaim',
  review: 'plan.status.inReview',
} as const satisfies Record<PlanLifecycle, TranslationKey>

const ACTION_BUTTON_STYLES = cn(
  WORKFLOW_ACTION_BUTTON_CLASSNAME,
  WORKFLOW_SWELL_ACTION_BUTTON_CLASSNAME
)

function getRingStyles(item: ResolvedPlanItem, selected: boolean): string {
  if (selected) return 'ring-[1.5px] ring-[var(--text-secondary)]'
  if (item.resolvedLifecycle === 'done') return 'ring-[1.5px] ring-[var(--border-success)]'
  if (item.resolvedLifecycle === 'active') return 'ring-[1.5px] ring-[var(--warning)]'
  if (item.resolvedLifecycle === 'review') return 'ring-[1.5px] ring-[var(--brand-accent)]'
  return ''
}

function getStatusDetail(item: ResolvedPlanItem, t: TranslationFunction): string {
  if (item.resolvedLifecycle === 'blocked') {
    return t('plan.node.waitingOn', { items: item.blockerIds.join(' + ') })
  }
  const status = t(STATUS_LABEL_KEYS[item.resolvedLifecycle])
  return item.agent ? `${status} · ${item.agent}` : status
}

function DagNodeActionBar({ data }: { data: PlanNodeData }) {
  const { t } = useI18n()

  return (
    <WorkflowActionBarView variant='swell'>
      <Tooltip.Root preferAbove>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Button
              variant='ghost'
              aria-label={
                data.item.issue.number === null
                  ? t('plan.node.issueNotLinked')
                  : t('plan.node.openIssueNumber', { number: data.item.issue.number })
              }
              className={cn(ACTION_BUTTON_STYLES, WORKFLOW_FIRST_SWELL_ACTION_BUTTON_CLASSNAME)}
              disabled={!data.issueUrl}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                if (data.issueUrl) window.open(data.issueUrl, '_blank', 'noopener,noreferrer')
              }}
            >
              <Task className='size-[14px]' />
            </Button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          {data.issueUrl ? t('plan.node.openIssue') : t('plan.node.issueNotLinked')}
        </Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root preferAbove>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Button
              variant='ghost'
              aria-label={
                data.item.primaryPr.number === null
                  ? t('plan.node.notOpened')
                  : t('plan.node.openPullRequestNumber', {
                      number: data.item.primaryPr.number,
                    })
              }
              className={ACTION_BUTTON_STYLES}
              disabled={!data.pullRequestUrl}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                if (data.pullRequestUrl) {
                  window.open(data.pullRequestUrl, '_blank', 'noopener,noreferrer')
                }
              }}
            >
              <Workflow className='size-[14px]' />
            </Button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          {data.pullRequestUrl ? t('plan.node.openPullRequest') : t('plan.node.notOpened')}
        </Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root preferAbove>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Button
              variant='ghost'
              aria-label={t('plan.node.deletePr')}
              className={cn(ACTION_BUTTON_STYLES, WORKFLOW_LAST_SWELL_ACTION_BUTTON_CLASSNAME)}
              disabled={!data.canRemove}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                data.onRemove()
              }}
            >
              <Trash className='size-[14px]' />
            </Button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>{t('plan.node.delete')}</Tooltip.Content>
      </Tooltip.Root>
    </WorkflowActionBarView>
  )
}

export function PlanNodeCard({ data, selected }: NodeProps<PlanNodeData>) {
  const { t } = useI18n()
  const { item } = data
  const ringStyles = getRingStyles(item, selected)

  return (
    <WorkflowBlockView
      id={item.id}
      type='workflow'
      name={item.title}
      isEnabled
      isLocked={false}
      hasRing={Boolean(ringStyles)}
      ringStyles={ringStyles}
      runPathStatus={item.resolvedLifecycle === 'done' ? 'success' : undefined}
      isRunning={item.resolvedLifecycle === 'active'}
      Icon={Workflow}
      iconBgColor='var(--surface-2)'
      horizontalHandles
      shouldShowDefaultHandles
      hasContentBelowHeader
      conditionRows={[]}
      routerRows={[]}
      showsErrorOutput={false}
      wouldCreateConnectionCycle={data.wouldCreateConnectionCycle}
      onSelect={data.onSelect}
      actionBar={<DagNodeActionBar data={data} />}
      typeLabel={t('plan.node.type')}
      rows={
        <>
          <SubBlockRowView
            title={t('plan.node.issue')}
            displayValue={
              item.issue.number === null ? t('plan.node.notLinked') : `#${item.issue.number}`
            }
          />
          <SubBlockRowView
            title={t('plan.node.pullRequest')}
            displayValue={
              item.primaryPr.number === null
                ? t('plan.node.notOpened')
                : `#${item.primaryPr.number}`
            }
          />
          <SubBlockRowView
            title={t('plan.node.wave', { wave: item.wave })}
            displayValue={getStatusDetail(item, t)}
          />
        </>
      }
    />
  )
}
