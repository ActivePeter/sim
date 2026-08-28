import { Badge, Chip, cn } from '@sim/emcn'
import {
  BrainCircuit,
  CircleCheck,
  CirclePause,
  Code,
  Fingerprint,
  FolderCode,
  Play,
  Split,
  Task,
  User,
  Workflow,
} from '@sim/emcn/icons'
import {
  getMergeBlockingItemIds,
  type PlanDependency,
  type PlanLifecycle,
  type ResolvedPlanItem,
} from '@/app/plan-graph-demo/plan-graph-model'

const STATUS_BADGES = {
  active: { label: 'Running', variant: 'purple' },
  blocked: { label: 'Blocked', variant: 'gray' },
  done: { label: 'Merged', variant: 'green' },
  planned: { label: 'Planned', variant: 'gray' },
  ready: { label: 'Ready', variant: 'blue-secondary' },
  review: { label: 'In review', variant: 'amber' },
} as const satisfies Record<
  PlanLifecycle,
  {
    label: string
    variant: 'amber' | 'blue-secondary' | 'gray' | 'green' | 'purple'
  }
>

interface NodeInspectorProps {
  availableAgent?: string
  dependencies: readonly PlanDependency[]
  item: ResolvedPlanItem
  items: readonly ResolvedPlanItem[]
  onAdvance: () => void
}

interface DetailRowProps {
  icon: typeof Task
  label: string
  value: string
}

function DetailRow({ icon: Icon, label, value }: DetailRowProps) {
  return (
    <div className='flex items-start gap-2.5 py-1.5'>
      <Icon className='mt-0.5 size-3.5 shrink-0 text-[var(--text-icon)]' />
      <div className='min-w-0 flex-1'>
        <p className='text-[10px] text-[var(--text-muted)]'>{label}</p>
        <p className='mt-0.5 break-words font-mono text-[var(--text-body)] text-xs'>{value}</p>
      </div>
    </div>
  )
}

interface GateRowProps {
  label: string
  passed: boolean
}

function GateRow({ label, passed }: GateRowProps) {
  const Icon = passed ? CircleCheck : CirclePause
  return (
    <div className='flex items-center gap-2 py-1'>
      <Icon
        className={cn(
          'size-3.5',
          passed ? 'text-[var(--text-success)]' : 'text-[var(--text-muted)]'
        )}
      />
      <span className='text-[var(--text-secondary)] text-xs'>{label}</span>
    </div>
  )
}

function getActionLabel(
  lifecycle: PlanLifecycle,
  availableAgent: string | undefined,
  mergeBlocked: boolean
): string {
  if (lifecycle === 'ready') {
    return availableAgent ? `Claim with ${availableAgent}` : 'No idle agent'
  }
  if (lifecycle === 'active') return 'Request review'
  if (lifecycle === 'review') {
    return mergeBlocked ? 'Waiting for integration gate' : 'Merge pull request'
  }
  if (lifecycle === 'blocked') return 'Waiting for dependencies'
  if (lifecycle === 'done') return 'Node completed'
  return 'Not ready'
}

export function NodeInspector({
  availableAgent,
  dependencies,
  item,
  items,
  onAdvance,
}: NodeInspectorProps) {
  const status = STATUS_BADGES[item.resolvedLifecycle]
  const prerequisiteIds = dependencies
    .filter((dependency) => dependency.target === item.id)
    .map((dependency) => dependency.source)
  const dependentIds = dependencies
    .filter((dependency) => dependency.source === item.id)
    .map((dependency) => dependency.target)
  const itemById = new Map(items.map((candidate) => [candidate.id, candidate]))
  const dependenciesPassed = item.blockerIds.length === 0
  const mergeBlockerIds = getMergeBlockingItemIds(item.id, items, dependencies)
  const mergeDependenciesPassed = mergeBlockerIds.length === 0
  const reviewPassed = item.primaryPr.review === 'Approved' || item.primaryPr.state === 'Merged'
  const checksPassed = item.primaryPr.checks === 'Passed' || item.primaryPr.state === 'Merged'
  const actionDisabled =
    !['ready', 'active', 'review'].includes(item.resolvedLifecycle) ||
    (item.resolvedLifecycle === 'ready' && !availableAgent) ||
    (item.resolvedLifecycle === 'review' && !mergeDependenciesPassed)

  return (
    <aside className='hidden min-h-0 w-[360px] shrink-0 flex-col border-[var(--border)] border-l bg-[var(--surface-1)] xl:flex'>
      <div className='flex items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-4'>
        <div className='min-w-0'>
          <div className='mb-1.5 flex items-center gap-2'>
            <span className='font-mono text-[var(--text-muted)] text-xs'>{item.id}</span>
            <Badge variant={status.variant} size='sm' dot>
              {status.label}
            </Badge>
          </div>
          <h2 className='text-[var(--text-primary)] text-base leading-6'>{item.title}</h2>
        </div>
        <Badge variant='type' size='sm'>
          Wave {item.wave}
        </Badge>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4'>
        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>Objective</p>
          <p className='text-[var(--text-secondary)] text-sm leading-5'>{item.summary}</p>
        </section>

        {item.blockerIds.length > 0 && (
          <section className='rounded-lg border border-[var(--badge-amber-bg)] bg-[color-mix(in_srgb,var(--badge-amber-bg)_35%,transparent)] p-3'>
            <div className='mb-1.5 flex items-center gap-1.5 text-[var(--badge-amber-text)] text-xs'>
              <CirclePause className='size-3.5' />
              Why this node is blocked
            </div>
            <p className='text-[var(--text-secondary)] text-xs leading-5'>
              Waiting for{' '}
              {item.blockerIds
                .map((blockerId) => itemById.get(blockerId)?.title ?? blockerId)
                .join(' and ')}
              .
            </p>
          </section>
        )}

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>Artifact bindings</p>
          <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5'>
            <DetailRow
              icon={Task}
              label='GitHub issue'
              value={`#${item.issue.number} · ${item.issue.state}`}
            />
            <DetailRow
              icon={Workflow}
              label='Primary pull request'
              value={
                item.primaryPr.state === 'Pending'
                  ? 'Pending first publish'
                  : `#${item.primaryPr.number} · ${item.primaryPr.state}`
              }
            />
            <DetailRow icon={User} label='Human owner' value={item.humanOwner} />
          </div>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>Dependencies</p>
          <div className='grid grid-cols-2 gap-2'>
            <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5'>
              <p className='text-[10px] text-[var(--text-muted)]'>Inputs and gates</p>
              <p className='mt-1 font-mono text-[var(--text-body)] text-xs'>
                {prerequisiteIds.length > 0 ? prerequisiteIds.join(' · ') : 'None'}
              </p>
            </div>
            <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5'>
              <p className='text-[10px] text-[var(--text-muted)]'>Unlocks</p>
              <p className='mt-1 font-mono text-[var(--text-body)] text-xs'>
                {dependentIds.length > 0 ? dependentIds.join(' · ') : 'None'}
              </p>
            </div>
          </div>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>Merge gates</p>
          <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
            <GateRow label='Start dependencies satisfied' passed={dependenciesPassed} />
            <GateRow label='Merge dependencies satisfied' passed={mergeDependenciesPassed} />
            <GateRow label='Parent SHA is current' passed={item.resolvedLifecycle !== 'blocked'} />
            <GateRow label='Required checks passed' passed={checksPassed} />
            <GateRow label='Review approved' passed={reviewPassed} />
          </div>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>Authority scope</p>
          <div className='flex flex-wrap gap-1'>
            {item.authorityScope.map((scope) => (
              <Badge key={scope} variant='outline' size='sm'>
                {scope}
              </Badge>
            ))}
          </div>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>Expected paths</p>
          <div className='space-y-1'>
            {item.expectedPaths.map((path) => (
              <div
                key={path}
                className='flex items-center gap-2 rounded-md bg-[var(--surface-3)] px-2 py-1.5 font-mono text-[var(--text-secondary)] text-xs'
              >
                <Code className='size-3 text-[var(--text-icon)]' />
                {path}
              </div>
            ))}
          </div>
        </section>

        {item.execution && (
          <section>
            <p className='mb-1.5 text-[var(--text-muted)] text-xs'>Execution attempt</p>
            <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5'>
              <DetailRow icon={BrainCircuit} label='Agent' value={item.agent ?? 'Unassigned'} />
              <DetailRow icon={Fingerprint} label='Session' value={item.execution.sessionId} />
              <DetailRow icon={FolderCode} label='Worktree' value={item.execution.worktree} />
              <DetailRow icon={Split} label='Branch' value={item.execution.branch} />
            </div>
          </section>
        )}
      </div>

      <div className='border-[var(--border)] border-t p-3'>
        <Chip
          variant={actionDisabled ? undefined : 'primary'}
          leftIcon={item.resolvedLifecycle === 'done' ? CircleCheck : Play}
          fullWidth
          disabled={actionDisabled}
          onClick={onAdvance}
        >
          {getActionLabel(item.resolvedLifecycle, availableAgent, !mergeDependenciesPassed)}
        </Chip>
      </div>
    </aside>
  )
}
