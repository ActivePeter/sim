'use client'

import { Badge, Button, Chip, ChipInput, ChipTextarea, cn } from '@sim/emcn'
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
  Trash,
  User,
  Workflow,
} from '@sim/emcn/icons'
import {
  type DagItemUpdate,
  getMergeBlockingItemIds,
  type PlanDependency,
  type PlanDependencyKind,
  type PlanLifecycle,
  type ResolvedPlanItem,
} from '@/lib/dags/model'
import { type TranslationFunction, type TranslationKey, useI18n } from '@/lib/i18n'

const DEPENDENCY_KINDS: readonly PlanDependencyKind[] = ['requires', 'contract', 'integrate-with']

const STATUS_BADGES = {
  active: { labelKey: 'plan.status.running', variant: 'purple' },
  blocked: { labelKey: 'plan.status.blocked', variant: 'gray' },
  done: { labelKey: 'plan.status.merged', variant: 'green' },
  planned: { labelKey: 'plan.status.planned', variant: 'gray' },
  ready: { labelKey: 'plan.status.ready', variant: 'blue-secondary' },
  review: { labelKey: 'plan.status.inReview', variant: 'amber' },
} as const satisfies Record<
  PlanLifecycle,
  {
    labelKey: TranslationKey
    variant: 'amber' | 'blue-secondary' | 'gray' | 'green' | 'purple'
  }
>

const GITHUB_STATE_KEYS = {
  Closed: 'plan.github.closed',
  Draft: 'plan.github.draft',
  Merged: 'plan.github.merged',
  Open: 'plan.github.open',
  Unknown: 'plan.github.unknown',
  Unopened: 'plan.github.unopened',
} as const satisfies Record<
  'Closed' | 'Draft' | 'Merged' | 'Open' | 'Unknown' | 'Unopened',
  TranslationKey
>

interface NodeInspectorProps {
  dependencies: readonly PlanDependency[]
  item: ResolvedPlanItem
  items: readonly ResolvedPlanItem[]
  onRemoveDependency: (dependencyId: string) => void
  onRemoveItem: () => void
  onUpdateDependencyKind: (dependencyId: string, kind: PlanDependencyKind) => void
  onUpdateItem: (update: DagItemUpdate) => void
  repository: string
  selectedItemCount: number
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
  mergeBlocked: boolean,
  t: TranslationFunction
): string {
  if (lifecycle === 'ready') return t('plan.inspector.action.ready')
  if (lifecycle === 'active') return t('plan.inspector.action.claimActive')
  if (lifecycle === 'review') {
    return mergeBlocked
      ? t('plan.inspector.action.integrationBlocked')
      : t('plan.inspector.action.waitingGithub')
  }
  if (lifecycle === 'blocked') return t('plan.inspector.action.waitingDependencies')
  if (lifecycle === 'done') return t('plan.inspector.action.completed')
  return t('plan.inspector.action.notReady')
}

function dependencyKindLabel(kind: PlanDependencyKind, t: TranslationFunction): string {
  if (kind === 'contract') return t('plan.dependency.contract')
  if (kind === 'integrate-with') return t('plan.dependency.integrateWith')
  return t('plan.dependency.requires')
}

function getNextDependencyKind(kind: PlanDependencyKind): PlanDependencyKind {
  const currentIndex = DEPENDENCY_KINDS.indexOf(kind)
  return DEPENDENCY_KINDS[(currentIndex + 1) % DEPENDENCY_KINDS.length]
}

export function NodeInspector({
  dependencies,
  item,
  items,
  onRemoveDependency,
  onRemoveItem,
  onUpdateDependencyKind,
  onUpdateItem,
  repository,
  selectedItemCount,
}: NodeInspectorProps) {
  const { locale, t } = useI18n()
  const status = STATUS_BADGES[item.resolvedLifecycle]
  const prerequisiteIds = dependencies
    .filter((dependency) => dependency.target === item.id)
    .map((dependency) => dependency.source)
  const incomingDependencies = dependencies.filter((dependency) => dependency.target === item.id)
  const dependentIds = dependencies
    .filter((dependency) => dependency.source === item.id)
    .map((dependency) => dependency.target)
  const itemById = new Map(items.map((candidate) => [candidate.id, candidate]))
  const dependenciesPassed = item.blockerIds.length === 0
  const mergeBlockerIds = getMergeBlockingItemIds(item.id, items, dependencies)
  const mergeDependenciesPassed = mergeBlockerIds.length === 0
  const reviewPassed = item.primaryPr.review === 'Approved' || item.primaryPr.state === 'Merged'
  const checksPassed = item.primaryPr.checks === 'Passed' || item.primaryPr.state === 'Merged'
  const claimCommand = `bun .agents/skills/plan-node/scripts/plan-node.ts claim --node ${item.id} --agent <agent-id>`

  return (
    <aside className='hidden min-h-0 w-[360px] shrink-0 flex-col border-[var(--border)] border-l bg-[var(--surface-1)] lg:flex'>
      <div className='flex items-start justify-between gap-3 border-[var(--border)] border-b px-4 py-4'>
        <div className='min-w-0'>
          <div className='mb-1.5 flex items-center gap-2'>
            <span className='font-mono text-[var(--text-muted)] text-xs'>{item.id}</span>
            <Badge variant={status.variant} size='sm' dot>
              {t(status.labelKey)}
            </Badge>
          </div>
          <h2 className='text-[var(--text-primary)] text-base leading-6'>{item.title}</h2>
        </div>
        <Badge variant='type' size='sm'>
          {t('plan.inspector.wave', { wave: item.wave })}
        </Badge>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4'>
        <section>
          <p className='mb-2 text-[var(--text-muted)] text-xs'>{t('plan.inspector.objective')}</p>
          <div className='space-y-2'>
            <div>
              <label
                className='mb-1 block text-[10px] text-[var(--text-muted)]'
                htmlFor={`${item.id}-title`}
              >
                {t('plan.inspector.title')}
              </label>
              <ChipInput
                key={`${item.id}-title-${item.title}`}
                id={`${item.id}-title`}
                defaultValue={item.title}
                onBlur={(event) => {
                  const title = event.currentTarget.value.trim()
                  if (title) onUpdateItem({ title })
                }}
              />
            </div>
            <div>
              <label
                className='mb-1 block text-[10px] text-[var(--text-muted)]'
                htmlFor={`${item.id}-summary`}
              >
                {t('plan.inspector.outcome')}
              </label>
              <ChipTextarea
                key={`${item.id}-summary-${item.summary}`}
                id={`${item.id}-summary`}
                rows={3}
                defaultValue={item.summary}
                onBlur={(event) => onUpdateItem({ summary: event.currentTarget.value.trim() })}
              />
            </div>
          </div>
        </section>

        {item.blockerIds.length > 0 && (
          <section className='rounded-lg border border-[var(--badge-amber-bg)] bg-[color-mix(in_srgb,var(--badge-amber-bg)_35%,transparent)] p-3'>
            <div className='mb-1.5 flex items-center gap-1.5 text-[var(--badge-amber-text)] text-xs'>
              <CirclePause className='size-3.5' />
              {t('plan.inspector.whyBlocked')}
            </div>
            <p className='text-[var(--text-secondary)] text-xs leading-5'>
              {t('plan.inspector.waitingFor', {
                items: item.blockerIds
                  .map((blockerId) => itemById.get(blockerId)?.title ?? blockerId)
                  .join(locale === 'zh-CN' ? '、' : ' and '),
              })}
            </p>
          </section>
        )}

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>
            {t('plan.inspector.artifactBindings')}
          </p>
          <div className='space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3'>
            <div>
              <label
                className='mb-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]'
                htmlFor={`${item.id}-repository`}
              >
                <FolderCode className='size-3 text-[var(--text-icon)]' />
                {t('plan.inspector.repository')}
              </label>
              <ChipInput
                key={`${item.id}-repository-${item.repository ?? repository}`}
                id={`${item.id}-repository`}
                inputClassName='font-mono'
                defaultValue={item.repository ?? repository}
                onBlur={(event) => {
                  const artifactRepository = event.currentTarget.value.trim()
                  if (/^[^/]+\/[^/]+$/.test(artifactRepository)) {
                    onUpdateItem({ repository: artifactRepository })
                  }
                }}
              />
            </div>
            <div>
              <label
                className='mb-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]'
                htmlFor={`${item.id}-local-repository-path`}
              >
                <FolderCode className='size-3 text-[var(--text-icon)]' />
                {t('plan.inspector.localRepositoryPath')}
              </label>
              <ChipInput
                key={`${item.id}-local-repository-path-${item.localRepositoryPath ?? ''}`}
                id={`${item.id}-local-repository-path`}
                inputClassName='font-mono'
                placeholder={t('plan.inspector.localRepositoryPathPlaceholder')}
                defaultValue={item.localRepositoryPath ?? ''}
                onBlur={(event) => {
                  const localRepositoryPath = event.currentTarget.value.trim()
                  onUpdateItem({ localRepositoryPath: localRepositoryPath || null })
                }}
              />
            </div>
            <div>
              <div className='mb-1 flex items-center justify-between gap-2'>
                <label
                  className='flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]'
                  htmlFor={`${item.id}-issue`}
                >
                  <Task className='size-3 text-[var(--text-icon)]' />
                  {t('plan.inspector.githubIssue')}
                </label>
                <Badge variant='outline' size='sm'>
                  {t(GITHUB_STATE_KEYS[item.issue.state])}
                </Badge>
              </div>
              <ChipInput
                key={`${item.id}-issue-${item.issue.number}`}
                id={`${item.id}-issue`}
                type='number'
                min={1}
                inputClassName='font-mono'
                defaultValue={item.issue.number ?? ''}
                onBlur={(event) => {
                  if (!event.currentTarget.value.trim()) {
                    onUpdateItem({ issueNumber: null })
                    return
                  }
                  const issueNumber = event.currentTarget.valueAsNumber
                  if (Number.isInteger(issueNumber) && issueNumber > 0) {
                    onUpdateItem({ issueNumber })
                  }
                }}
              />
            </div>
            <div>
              <div className='mb-1 flex items-center justify-between gap-2'>
                <label
                  className='flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]'
                  htmlFor={`${item.id}-pr`}
                >
                  <Workflow className='size-3 text-[var(--text-icon)]' />
                  {t('plan.inspector.primaryPullRequest')}
                </label>
                <Badge variant='outline' size='sm'>
                  {t(GITHUB_STATE_KEYS[item.primaryPr.state])}
                </Badge>
              </div>
              <ChipInput
                key={`${item.id}-pr-${item.primaryPr.number}`}
                id={`${item.id}-pr`}
                type='number'
                min={1}
                placeholder={t('plan.node.notOpened')}
                inputClassName='font-mono'
                defaultValue={item.primaryPr.number ?? ''}
                onBlur={(event) => {
                  if (!event.currentTarget.value.trim()) {
                    onUpdateItem({ primaryPrNumber: null })
                    return
                  }
                  const primaryPrNumber = event.currentTarget.valueAsNumber
                  if (Number.isInteger(primaryPrNumber) && primaryPrNumber > 0) {
                    onUpdateItem({ primaryPrNumber })
                  }
                }}
              />
            </div>
            <div>
              <label
                className='mb-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]'
                htmlFor={`${item.id}-owner`}
              >
                <User className='size-3 text-[var(--text-icon)]' />
                {t('plan.inspector.humanOwner')}
              </label>
              <ChipInput
                key={`${item.id}-owner-${item.humanOwner}`}
                id={`${item.id}-owner`}
                defaultValue={item.humanOwner}
                onBlur={(event) => onUpdateItem({ humanOwner: event.currentTarget.value.trim() })}
              />
            </div>
          </div>
        </section>

        <section>
          <div className='mb-1.5 flex items-center justify-between gap-2'>
            <p className='text-[var(--text-muted)] text-xs'>{t('plan.inspector.dependencies')}</p>
            <span className='text-[10px] text-[var(--text-muted)]'>
              {t('plan.inspector.clickPolicy')}
            </span>
          </div>
          <div className='space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2.5'>
            {incomingDependencies.length > 0 ? (
              incomingDependencies.map((dependency) => (
                <div key={dependency.id} className='flex items-center gap-2'>
                  <span className='min-w-0 flex-1 truncate font-mono text-[var(--text-body)] text-xs'>
                    {dependency.source} → {dependency.target}
                  </span>
                  <Chip
                    active
                    onClick={() =>
                      onUpdateDependencyKind(dependency.id, getNextDependencyKind(dependency.kind))
                    }
                  >
                    {dependencyKindLabel(dependency.kind, t)}
                  </Chip>
                  <Button
                    variant='quiet'
                    size='icon'
                    aria-label={t('plan.inspector.removeDependency', {
                      sourceId: dependency.source,
                      targetId: dependency.target,
                    })}
                    onClick={() => onRemoveDependency(dependency.id)}
                  >
                    <Trash className='size-3.5' />
                  </Button>
                </div>
              ))
            ) : (
              <p className='py-1 text-[var(--text-muted)] text-xs'>
                {t('plan.inspector.noIncomingDependencies')}
              </p>
            )}
            <div className='grid grid-cols-2 gap-2 border-[var(--border)] border-t pt-2'>
              <div>
                <p className='text-[10px] text-[var(--text-muted)]'>{t('plan.inspector.inputs')}</p>
                <p className='mt-1 truncate font-mono text-[var(--text-body)] text-xs'>
                  {prerequisiteIds.length > 0 ? prerequisiteIds.join(' · ') : t('common.none')}
                </p>
              </div>
              <div>
                <p className='text-[10px] text-[var(--text-muted)]'>
                  {t('plan.inspector.unlocks')}
                </p>
                <p className='mt-1 truncate font-mono text-[var(--text-body)] text-xs'>
                  {dependentIds.length > 0 ? dependentIds.join(' · ') : t('common.none')}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>
            {t('plan.inspector.mergeGates')}
          </p>
          <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2'>
            <GateRow
              label={t('plan.inspector.startDependenciesSatisfied')}
              passed={dependenciesPassed}
            />
            <GateRow
              label={t('plan.inspector.mergeDependenciesSatisfied')}
              passed={mergeDependenciesPassed}
            />
            <GateRow
              label={t('plan.inspector.parentShaCurrent')}
              passed={item.resolvedLifecycle !== 'blocked'}
            />
            <GateRow label={t('plan.inspector.requiredChecksPassed')} passed={checksPassed} />
            <GateRow label={t('plan.inspector.reviewApproved')} passed={reviewPassed} />
          </div>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>
            {t('plan.inspector.interfaces')}
          </p>
          <div className='space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3'>
            {item.interfaces.map((planInterface) => (
              <article key={planInterface.name}>
                <h3 className='text-[var(--text-body)] text-xs'>{planInterface.name}</h3>
                <p className='mt-1 break-words rounded bg-[var(--surface-3)] px-2 py-1.5 font-mono text-[10px] text-[var(--text-secondary)] leading-4'>
                  {planInterface.usage}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>
            {t('plan.inspector.agentClaim')}
          </p>
          <p className='break-words rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 font-mono text-[10px] text-[var(--text-secondary)] leading-4'>
            {claimCommand}
          </p>
        </section>

        <section>
          <p className='mb-1.5 text-[var(--text-muted)] text-xs'>
            {t('plan.inspector.expectedPaths')}
          </p>
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
            <p className='mb-1.5 text-[var(--text-muted)] text-xs'>
              {t('plan.inspector.executionAttempt')}
            </p>
            <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5'>
              <DetailRow
                icon={BrainCircuit}
                label={t('plan.inspector.agent')}
                value={item.agent ?? t('common.unassigned')}
              />
              <DetailRow
                icon={Fingerprint}
                label={t('plan.inspector.session')}
                value={item.execution.sessionId}
              />
              <DetailRow
                icon={Fingerprint}
                label={t('plan.inspector.attempt')}
                value={item.execution.attemptId}
              />
              <div className='py-1.5'>
                <label
                  className='mb-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]'
                  htmlFor={`${item.id}-worktree`}
                >
                  <FolderCode className='size-3 text-[var(--text-icon)]' />
                  {t('plan.inspector.worktree')}
                </label>
                <ChipInput
                  key={`${item.id}-worktree-${item.execution.worktree}`}
                  id={`${item.id}-worktree`}
                  inputClassName='font-mono'
                  defaultValue={item.execution.worktree}
                  onBlur={(event) => {
                    const executionWorktree = event.currentTarget.value.trim()
                    if (executionWorktree) onUpdateItem({ executionWorktree })
                  }}
                />
              </div>
              <div className='py-1.5'>
                <label
                  className='mb-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]'
                  htmlFor={`${item.id}-branch`}
                >
                  <Split className='size-3 text-[var(--text-icon)]' />
                  {t('plan.inspector.branch')}
                </label>
                <ChipInput
                  key={`${item.id}-branch-${item.execution.branch}`}
                  id={`${item.id}-branch`}
                  inputClassName='font-mono'
                  defaultValue={item.execution.branch}
                  onBlur={(event) => {
                    const executionBranch = event.currentTarget.value.trim()
                    if (executionBranch) onUpdateItem({ executionBranch })
                  }}
                />
              </div>
              <DetailRow
                icon={Fingerprint}
                label={t('plan.inspector.writerFencingToken')}
                value={String(item.execution.lease.fencingToken)}
              />
            </div>
          </section>
        )}
      </div>

      <div className='flex gap-2 border-[var(--border)] border-t p-3'>
        <Badge
          variant={item.resolvedLifecycle === 'ready' ? 'blue-secondary' : 'outline'}
          icon={item.resolvedLifecycle === 'done' ? CircleCheck : Play}
          className='min-w-0 flex-1 justify-center'
        >
          {getActionLabel(item.resolvedLifecycle, !mergeDependenciesPassed, t)}
        </Badge>
        <Chip variant='destructive' leftIcon={Trash} onClick={onRemoveItem}>
          {selectedItemCount > 1
            ? t('plan.inspector.deleteSelected', { count: selectedItemCount })
            : t('plan.inspector.delete')}
        </Chip>
      </div>
    </aside>
  )
}
