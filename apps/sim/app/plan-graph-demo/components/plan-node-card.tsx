import { Button, cn, Tooltip } from '@sim/emcn'
import { PlayOutline, Task, Trash, Workflow } from '@sim/emcn/icons'
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
import type { PlanLifecycle, ResolvedPlanItem } from '@/app/plan-graph-demo/plan-graph-model'

export interface PlanNodeData {
  canRemove: boolean
  issueUrl: string
  item: ResolvedPlanItem
  onAdvance: () => void
  onRemove: () => void
  onSelect: () => void
  pullRequestUrl?: string
  wouldCreateConnectionCycle: (source: string, target: string) => boolean
}

const STATUS_LABELS = {
  active: 'Running',
  blocked: 'Blocked',
  done: 'Merged',
  planned: 'Planned',
  ready: 'Ready to claim',
  review: 'In review',
} as const satisfies Record<PlanLifecycle, string>

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

function getStatusDetail(item: ResolvedPlanItem): string {
  if (item.resolvedLifecycle === 'blocked') return `Waiting on ${item.blockerIds.join(' + ')}`
  if (item.agent) return `${STATUS_LABELS[item.resolvedLifecycle]} · ${item.agent}`
  return STATUS_LABELS[item.resolvedLifecycle]
}

function DagNodeActionBar({ data }: { data: PlanNodeData }) {
  const canAdvance = ['ready', 'active', 'review'].includes(data.item.resolvedLifecycle)

  return (
    <WorkflowActionBarView variant='swell'>
      <Tooltip.Root preferAbove>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Button
              variant='ghost'
              aria-label='Advance PR node'
              className={cn(
                ACTION_BUTTON_STYLES,
                WORKFLOW_FIRST_SWELL_ACTION_BUTTON_CLASSNAME,
                '[&>svg]:translate-x-[8px]'
              )}
              disabled={!canAdvance}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                data.onAdvance()
              }}
            >
              <PlayOutline className='size-[14px]' />
            </Button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>Advance node</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root preferAbove>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Button
              variant='ghost'
              aria-label={`Open issue ${data.item.issue.number}`}
              className={ACTION_BUTTON_STYLES}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                window.open(data.issueUrl, '_blank', 'noopener,noreferrer')
              }}
            >
              <Task className='size-[14px]' />
            </Button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>Open issue</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root preferAbove>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Button
              variant='ghost'
              aria-label={
                data.item.primaryPr.number === null
                  ? 'Pull request not opened'
                  : `Open pull request ${data.item.primaryPr.number}`
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
          {data.pullRequestUrl ? 'Open pull request' : 'Pull request not opened'}
        </Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root preferAbove>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Button
              variant='ghost'
              aria-label='Delete PR node'
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
        <Tooltip.Content side='top'>Delete node</Tooltip.Content>
      </Tooltip.Root>
    </WorkflowActionBarView>
  )
}

export function PlanNodeCard({ data, selected }: NodeProps<PlanNodeData>) {
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
      typeLabel='PR'
      rows={
        <>
          <SubBlockRowView title='Issue' displayValue={`#${item.issue.number}`} />
          <SubBlockRowView
            title='Pull request'
            displayValue={
              item.primaryPr.number === null ? 'Not opened' : `#${item.primaryPr.number}`
            }
          />
          <SubBlockRowView title={`Wave ${item.wave}`} displayValue={getStatusDetail(item)} />
        </>
      }
    />
  )
}
