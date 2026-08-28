import { Avatar, AvatarFallback, Badge, cn } from '@sim/emcn'
import { BrainCircuit, CircleCheck, CirclePause, Clock, User } from '@sim/emcn/icons'
import {
  DEMO_AGENTS,
  type PlanCounts,
  type PlanLifecycle,
  type ResolvedPlanItem,
} from '@/app/plan-graph-demo/plan-graph-model'

const STATUS_SUMMARY = [
  { lifecycle: 'ready', label: 'Ready', icon: CircleCheck },
  { lifecycle: 'active', label: 'Running', icon: BrainCircuit },
  { lifecycle: 'review', label: 'In review', icon: Clock },
  { lifecycle: 'blocked', label: 'Blocked', icon: CirclePause },
] as const satisfies readonly {
  lifecycle: PlanLifecycle
  label: string
  icon: typeof CircleCheck
}[]

interface PlanSidebarProps {
  counts: PlanCounts
  items: readonly ResolvedPlanItem[]
}

function getLifecycleCount(counts: PlanCounts, lifecycle: PlanLifecycle): number {
  if (lifecycle === 'ready') return counts.ready
  if (lifecycle === 'active') return counts.active
  if (lifecycle === 'review') return counts.review
  if (lifecycle === 'blocked') return counts.blocked
  if (lifecycle === 'done') return counts.done
  return 0
}

export function PlanSidebar({ counts, items }: PlanSidebarProps) {
  const activeAgents = new Set(
    items
      .filter((item) => item.resolvedLifecycle === 'active')
      .map((item) => item.agent)
      .filter((agent): agent is string => Boolean(agent))
  )

  return (
    <aside className='hidden min-h-0 flex-col border-[var(--border)] border-r bg-[var(--surface-1)] lg:flex'>
      <div className='border-[var(--border)] border-b px-4 py-4'>
        <div className='mb-3 flex items-center justify-between'>
          <p className='text-[var(--text-primary)] text-sm'>Plan progress</p>
          <span className='font-mono text-[var(--text-muted)] text-xs'>
            {counts.done}/{counts.total}
          </span>
        </div>
        <div
          className='grid grid-cols-6 gap-1'
          aria-label={`${counts.done} of ${counts.total} done`}
        >
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                'h-1.5 rounded-full',
                item.resolvedLifecycle === 'done'
                  ? 'bg-[var(--brand-accent)]'
                  : item.resolvedLifecycle === 'active'
                    ? 'bg-[var(--brand-agent)]'
                    : item.resolvedLifecycle === 'ready'
                      ? 'bg-[var(--brand-secondary)]'
                      : 'bg-[var(--surface-5)]'
              )}
            />
          ))}
        </div>
      </div>

      <div className='flex flex-col gap-5 overflow-y-auto px-3 py-4'>
        <section>
          <p className='mb-2 px-1 text-[var(--text-muted)] text-xs'>Status</p>
          <div className='flex flex-col gap-0.5'>
            {STATUS_SUMMARY.map(({ lifecycle, label, icon: Icon }) => (
              <div
                key={lifecycle}
                className='flex h-8 items-center justify-between rounded-lg px-2 text-[var(--text-secondary)]'
              >
                <span className='flex items-center gap-2 text-sm'>
                  <Icon className='size-[14px] text-[var(--text-icon)]' />
                  {label}
                </span>
                <span className='font-mono text-xs'>{getLifecycleCount(counts, lifecycle)}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <p className='mb-2 px-1 text-[var(--text-muted)] text-xs'>Merge waves</p>
          <div className='space-y-1.5'>
            {[0, 1, 2, 3].map((wave) => {
              const waveItems = items.filter((item) => item.wave === wave)
              const waveDone = waveItems.every((item) => item.resolvedLifecycle === 'done')
              return (
                <div
                  key={wave}
                  className='flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2'
                >
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full font-mono text-[10px]',
                      waveDone
                        ? 'bg-[var(--badge-success-bg)] text-[var(--badge-success-text)]'
                        : 'bg-[var(--surface-5)] text-[var(--text-secondary)]'
                    )}
                  >
                    {wave}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-[var(--text-secondary)] text-xs'>
                    {waveItems.map((item) => item.id).join(' · ')}
                  </span>
                  {waveDone && <CircleCheck className='size-3 text-[var(--text-success)]' />}
                </div>
              )
            })}
          </div>
        </section>

        <section>
          <div className='mb-2 flex items-center justify-between px-1'>
            <p className='text-[var(--text-muted)] text-xs'>Agent capacity</p>
            <Badge variant='gray-secondary' size='sm'>
              {activeAgents.size}/{DEMO_AGENTS.length}
            </Badge>
          </div>
          <div className='space-y-1'>
            {DEMO_AGENTS.map((agent) => {
              const isActive = activeAgents.has(agent)
              return (
                <div key={agent} className='flex items-center gap-2 rounded-lg px-2 py-1.5'>
                  <Avatar size='sm' status={isActive ? 'busy' : 'online'}>
                    <AvatarFallback>
                      <BrainCircuit className='size-3' />
                    </AvatarFallback>
                  </Avatar>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-[var(--text-body)] text-xs'>{agent}</p>
                    <p className='text-[10px] text-[var(--text-muted)]'>
                      {isActive ? 'Writer lease active' : 'Ready to claim'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3'>
          <div className='mb-1.5 flex items-center gap-1.5 text-[var(--text-primary)] text-xs'>
            <User className='size-3 text-[var(--text-icon)]' />
            Human authority
          </div>
          <p className='text-[var(--text-muted)] text-xs leading-5'>
            Peter owns graph revision 7. Agents may execute Ready nodes, but cannot rewrite
            dependencies.
          </p>
        </section>
      </div>
    </aside>
  )
}
