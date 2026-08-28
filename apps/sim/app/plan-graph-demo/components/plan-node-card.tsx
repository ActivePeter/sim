import { Badge, cn } from '@sim/emcn'
import { BrainCircuit, CircleCheck, CirclePause, Task, Workflow } from '@sim/emcn/icons'
import { Handle, type NodeProps, Position } from 'reactflow'
import type { PlanLifecycle, ResolvedPlanItem } from '@/app/plan-graph-demo/plan-graph-model'

export interface PlanNodeData {
  item: ResolvedPlanItem
}

const STATUS_BADGES = {
  active: { label: 'Running', variant: 'purple' },
  blocked: { label: 'Blocked', variant: 'gray' },
  done: { label: 'Merged', variant: 'green' },
  planned: { label: 'Planned', variant: 'gray' },
  ready: { label: 'Ready', variant: 'blue-secondary' },
  review: { label: 'Review', variant: 'amber' },
} as const satisfies Record<
  PlanLifecycle,
  {
    label: string
    variant: 'amber' | 'blue-secondary' | 'gray' | 'green' | 'purple'
  }
>

const KIND_LABELS = {
  contract: 'Contract',
  implementation: 'Implementation',
  integration: 'Integration',
} as const

function NodeReceipt({ item }: { item: ResolvedPlanItem }) {
  if (item.resolvedLifecycle === 'blocked') {
    return (
      <div className='flex items-center gap-1.5 text-[var(--text-muted)] text-xs'>
        <CirclePause className='size-3' />
        Waiting on {item.blockerIds.join(' + ')}
      </div>
    )
  }

  if (item.resolvedLifecycle === 'ready') {
    return (
      <div className='flex items-center gap-1.5 text-[var(--badge-blue-secondary-text)] text-xs'>
        <CircleCheck className='size-3' />
        Available to claim
      </div>
    )
  }

  if (item.agent) {
    return (
      <div className='flex items-center gap-1.5 text-[var(--text-secondary)] text-xs'>
        <BrainCircuit className='size-3' />
        {item.agent}
        {item.execution ? ` · ${item.execution.status}` : ''}
      </div>
    )
  }

  return null
}

export function PlanNodeCard({ data, selected }: NodeProps<PlanNodeData>) {
  const { item } = data
  const status = STATUS_BADGES[item.resolvedLifecycle]

  return (
    <article
      className={cn(
        'w-[260px] overflow-hidden rounded-xl border bg-[var(--surface-2)] shadow-[0_6px_18px_rgba(0,0,0,0.06)] transition-[border-color,box-shadow,transform] duration-150',
        selected
          ? 'border-[var(--brand-secondary)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--brand-secondary)_18%,transparent),0_8px_24px_rgba(0,0,0,0.08)]'
          : 'border-[var(--border)] hover-hover:border-[var(--border-1)]'
      )}
    >
      <Handle
        type='target'
        position={Position.Left}
        title='Drop a dependency here'
        className='!size-3 !cursor-crosshair !border-2 !border-[var(--surface-2)] !bg-[var(--brand-secondary)]'
      />

      <div className='flex items-center justify-between gap-2 border-[var(--border)] border-b px-3 py-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='font-mono text-[var(--text-muted)] text-xs'>{item.id}</span>
          <span className='text-[var(--text-muted)] text-xs'>Wave {item.wave}</span>
        </div>
        <Badge variant={status.variant} size='sm' dot>
          {status.label}
        </Badge>
      </div>

      <div className='flex flex-col gap-3 px-3 py-3'>
        <div>
          <p className='mb-1 text-[var(--text-muted)] text-xs'>{KIND_LABELS[item.kind]}</p>
          <h2 className='text-[var(--text-primary)] text-sm leading-5'>{item.title}</h2>
        </div>

        <div className='flex items-center gap-3 text-[var(--text-secondary)] text-xs'>
          <span className='flex items-center gap-1'>
            <Task className='size-3' />
            Issue #{item.issue.number}
          </span>
          <span className='flex items-center gap-1'>
            <Workflow className='size-3' />
            {item.primaryPr.state === 'Pending' ? 'PR pending' : `PR #${item.primaryPr.number}`}
          </span>
        </div>

        <NodeReceipt item={item} />
      </div>

      <Handle
        type='source'
        position={Position.Right}
        title='Drag to another node to add a dependency'
        className='!size-3 !cursor-crosshair !border-2 !border-[var(--surface-2)] !bg-[var(--brand-secondary)]'
      />
    </article>
  )
}
