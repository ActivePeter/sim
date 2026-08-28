import { Badge, Chip, ChipLink } from '@sim/emcn'
import { Play, Plus, RefreshCw, SquareArrowUpRight, Workflow } from '@sim/emcn/icons'
import type { PlanCounts } from '@/app/plan-graph-demo/plan-graph-model'

interface PlanHeaderProps {
  availableAgent?: string
  counts: PlanCounts
  name: string
  onAddNode: () => void
  onClaimNext: () => void
  onReset: () => void
  revision: number
}

export function PlanHeader({
  availableAgent,
  counts,
  name,
  onAddNode,
  onClaimNext,
  onReset,
  revision,
}: PlanHeaderProps) {
  return (
    <header className='flex h-[58px] shrink-0 items-center justify-between gap-4 border-[var(--border)] border-b bg-[var(--surface-1)] px-4'>
      <div className='flex min-w-0 items-center gap-3'>
        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--text-primary)] text-[var(--text-inverse)]'>
          <Workflow className='size-4' />
        </div>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <h1 className='truncate text-[var(--text-primary)] text-sm'>{name}</h1>
            <Badge variant='purple' size='sm'>
              Roadmap
            </Badge>
          </div>
          <p className='truncate text-[var(--text-muted)] text-xs'>
            ActivePeter/sim · plan graph · revision {revision}
          </p>
        </div>
      </div>

      <div className='hidden items-center gap-2 lg:flex'>
        <Badge variant='blue-secondary' size='sm' dot>
          {counts.ready} ready
        </Badge>
        <Badge variant='purple' size='sm' dot>
          {counts.active} running
        </Badge>
        <Badge variant='gray' size='sm' dot>
          {counts.blocked} blocked
        </Badge>
      </div>

      <div className='flex shrink-0 items-center gap-1.5'>
        <ChipLink
          href='https://github.com/ActivePeter/sim/issues/1'
          target='_blank'
          rel='noreferrer'
          leftIcon={SquareArrowUpRight}
          className='hidden sm:inline-flex'
        >
          Epic #1
        </ChipLink>
        <Chip leftIcon={Plus} onClick={onAddNode}>
          Add node
        </Chip>
        <Chip leftIcon={RefreshCw} onClick={onReset}>
          Reset
        </Chip>
        <Chip
          variant='primary'
          leftIcon={Play}
          disabled={counts.ready === 0 || !availableAgent}
          onClick={onClaimNext}
        >
          {availableAgent ? `Claim next · ${availableAgent}` : 'No idle agent'}
        </Chip>
      </div>
    </header>
  )
}
