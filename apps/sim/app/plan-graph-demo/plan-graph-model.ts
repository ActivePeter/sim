import { z } from 'zod'
import type { CanvasDocumentKind } from '@/lib/canvas/types'
import { DEFAULT_DEMO_DAG_ID, getDemoDag } from '@/lib/dags/demo-catalog'

export type StoredPlanLifecycle = 'planned' | 'active' | 'review' | 'done'
export type PlanLifecycle = StoredPlanLifecycle | 'ready' | 'blocked'
export type PlanNodeKind = 'contract' | 'implementation' | 'integration'
export type PlanDependencyKind = 'contract' | 'requires' | 'integrate-with'
export type PullRequestState = 'Unopened' | 'Draft' | 'Open' | 'Closed' | 'Merged'
export type CheckState = 'Pending' | 'Running' | 'Passed' | 'Failed'
export type ReviewState = 'Pending' | 'Approved' | 'Changes requested'

export interface PlanIssueBinding {
  number: number | null
  state: 'Open' | 'Closed' | 'Unknown'
  url?: string
}

export interface PlanPullRequestBinding {
  number: number | null
  state: PullRequestState
  checks: CheckState
  review: ReviewState
  url?: string
  baseSha?: string
  headSha?: string
  mergeable?: boolean | null
  syncedAt?: string
}

export interface PlanInterface {
  name: string
  usage: string
}

export interface PlanExecution {
  attemptId: string
  sessionId: string
  worktree: string
  branch: string
  baseBranch: string
  baseSha: string
  headSha: string
  status: 'running' | 'waiting-review' | 'completed' | 'failed'
  lease: {
    state: 'active' | 'released' | 'expired'
    fencingToken: number
    claimedAt: string
    expiresAt: string
  }
}

export interface PlanItem {
  id: string
  title: string
  summary: string
  kind: PlanNodeKind
  wave: number
  lifecycle: StoredPlanLifecycle
  humanOwner: string
  interfaces: PlanInterface[]
  expectedPaths: string[]
  issue: PlanIssueBinding
  primaryPr: PlanPullRequestBinding
  agent?: string
  execution?: PlanExecution
}

export interface PlanDependency {
  id: string
  source: string
  target: string
  kind: PlanDependencyKind
}

export interface ResolvedPlanItem extends PlanItem {
  resolvedLifecycle: PlanLifecycle
  blockerIds: string[]
}

export interface PlanCounts {
  active: number
  blocked: number
  done: number
  ready: number
  review: number
  total: number
}

export interface PlanPosition {
  x: number
  y: number
}

export interface DagDocument {
  schemaVersion: 1
  dependencies: PlanDependency[]
  defaultBranch: string
  id: string
  items: PlanItem[]
  kind: Extract<CanvasDocumentKind, 'dag'>
  lastGithubSyncAt?: string
  name: string
  positions: Record<string, PlanPosition>
  remote: string
  repository: string
  revision: number
}

export interface DagItemUpdate {
  executionBranch?: string
  executionWorktree?: string
  humanOwner?: string
  issueNumber?: number | null
  primaryPrNumber?: number | null
  summary?: string
  title?: string
}

export interface PlanClaimInput {
  agent: string
  attemptId: string
  baseSha: string
  branch: string
  claimedAt: string
  expiresAt: string
  sessionId: string
  worktree: string
}

export interface GitHubBindingUpdate {
  itemId: string
  issue?: PlanIssueBinding
  primaryPr?: PlanPullRequestBinding
}

const INITIAL_PLAN_ITEMS: readonly PlanItem[] = [
  {
    id: 'PG-01',
    title: 'Self-hosting Plan Graph MVP',
    summary:
      "Persist Sim's own roadmap, atomically claim work, reconcile its real pull request, and hand an executable worktree brief to an agent.",
    kind: 'implementation',
    wave: 0,
    lifecycle: 'planned',
    humanOwner: 'Peter',
    interfaces: [
      {
        name: 'Plan document CAS',
        usage: 'PUT file content with expectedContentUpdatedAt from the latest read.',
      },
      {
        name: 'Agent node claim',
        usage:
          'bun .agents/skills/plan-node/scripts/plan-node.ts claim --node PG-01 --agent codex-01',
      },
      {
        name: 'GitHub reconciliation',
        usage: 'Select Sync GitHub to refresh Issue, PR, checks, review, and merge state.',
      },
      {
        name: 'Latest trial service',
        usage: 'bun run deploy:sim:latest → http://<host>:3300/plan-graph-demo',
      },
      {
        name: 'Pinned snapshot service',
        usage: 'bun run deploy:sim:snapshot:update → http://<host>:3301/plan-graph-demo',
      },
    ],
    expectedPaths: [
      'apps/sim/app/plan-graph-demo',
      'apps/sim/hooks/queries',
      '.agents/skills/plan-node',
      '.agents/skills/deploy-sim-latest',
      '.agents/skills/deploy-sim-snapshot',
      'scripts/deploy-sim-dev.sh',
    ],
    issue: {
      number: 1,
      state: 'Open',
      url: 'https://github.com/ActivePeter/sim/issues/1',
    },
    primaryPr: {
      number: null,
      state: 'Unopened',
      checks: 'Pending',
      review: 'Pending',
    },
  },
  {
    id: 'PG-02',
    title: 'Agent environment provider',
    summary:
      'Turn an accepted claim into an isolated worktree, branch, session, heartbeat, and recoverable execution attempt.',
    kind: 'implementation',
    wave: 1,
    lifecycle: 'planned',
    humanOwner: 'Unassigned',
    interfaces: [
      {
        name: 'Environment provision',
        usage: 'provision({ repository, branch, baseSha, attemptId }) → { worktree }',
      },
      {
        name: 'Lease heartbeat',
        usage: 'heartbeat({ nodeId, attemptId, fencingToken })',
      },
    ],
    expectedPaths: ['packages/plan-runtime', 'apps/sim/lib/plan-runtime'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-03',
    title: 'Durable GitHub event reconciliation',
    summary:
      'Replace manual public polling with authenticated reconciliation, idempotent webhooks, delivery cursors, and drift detection.',
    kind: 'integration',
    wave: 1,
    lifecycle: 'planned',
    humanOwner: 'Unassigned',
    interfaces: [
      {
        name: 'Repository snapshot',
        usage: 'reconcile({ repository, issue, pullRequest, lastExternalVersion })',
      },
      {
        name: 'Webhook ingest',
        usage: 'ingest({ deliveryId, event, payload })',
      },
    ],
    expectedPaths: ['apps/sim/lib/plan-github', 'apps/sim/app/api/webhooks/github'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-04',
    title: 'Dedicated plan persistence and realtime',
    summary:
      'Move the workspace-file MVP into Plan Space tables, revision events, presence, and collaborative graph projection.',
    kind: 'implementation',
    wave: 1,
    lifecycle: 'planned',
    humanOwner: 'Unassigned',
    interfaces: [
      {
        name: 'Plan repository',
        usage: 'saveRevision({ planId, expectedRevision, graph })',
      },
      {
        name: 'Plan event stream',
        usage: 'subscribe({ planId, afterCursor })',
      },
    ],
    expectedPaths: ['packages/plan-persistence', 'apps/realtime'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-05',
    title: 'Parent SHA and merge barriers',
    summary:
      'Detect stale stacked branches, expose Needs Sync, and enforce dependency-aware review and merge gates.',
    kind: 'contract',
    wave: 2,
    lifecycle: 'planned',
    humanOwner: 'Unassigned',
    interfaces: [
      {
        name: 'Merge decision',
        usage: 'evaluateMerge({ node, prerequisites, githubSnapshot }) → blockers[]',
      },
    ],
    expectedPaths: ['packages/plan-policy', 'apps/sim/lib/plan-policy'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-06',
    title: 'Fan-out and fan-in self-hosting proof',
    summary:
      'Run two agents on independent branches, converge through an integration gate, and recover the whole graph after restart.',
    kind: 'integration',
    wave: 3,
    lifecycle: 'planned',
    humanOwner: 'Peter',
    interfaces: [
      {
        name: 'Self-hosting acceptance',
        usage: 'A → (B, C) → D completes with distinct attempts, worktrees, PRs, and checks.',
      },
    ],
    expectedPaths: ['apps/sim/app/plan-graph', 'apps/sim/e2e/plan-graph'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
]

export const PLAN_DEPENDENCIES: readonly PlanDependency[] = [
  { id: 'edge-01-02', source: 'PG-01', target: 'PG-02', kind: 'requires' },
  { id: 'edge-01-03', source: 'PG-01', target: 'PG-03', kind: 'requires' },
  { id: 'edge-01-04', source: 'PG-01', target: 'PG-04', kind: 'requires' },
  { id: 'edge-02-05', source: 'PG-02', target: 'PG-05', kind: 'requires' },
  { id: 'edge-03-05', source: 'PG-03', target: 'PG-05', kind: 'requires' },
  { id: 'edge-04-06', source: 'PG-04', target: 'PG-06', kind: 'requires' },
  { id: 'edge-05-06', source: 'PG-05', target: 'PG-06', kind: 'integrate-with' },
]

export const INITIAL_PLAN_POSITIONS: Readonly<Record<string, PlanPosition>> = {
  'PG-01': { x: 40, y: 250 },
  'PG-02': { x: 380, y: 40 },
  'PG-03': { x: 380, y: 280 },
  'PG-04': { x: 380, y: 520 },
  'PG-05': { x: 730, y: 160 },
  'PG-06': { x: 1080, y: 300 },
}

const issueSchema = z.object({
  number: z.number().int().positive().nullable(),
  state: z.enum(['Open', 'Closed', 'Unknown']),
  url: z.string().url().optional(),
})
const pullRequestSchema = z.object({
  number: z.number().int().positive().nullable(),
  state: z.enum(['Unopened', 'Draft', 'Open', 'Closed', 'Merged']),
  checks: z.enum(['Pending', 'Running', 'Passed', 'Failed']),
  review: z.enum(['Pending', 'Approved', 'Changes requested']),
  url: z.string().url().optional(),
  baseSha: z.string().optional(),
  headSha: z.string().optional(),
  mergeable: z.boolean().nullable().optional(),
  syncedAt: z.string().datetime().optional(),
})
const executionSchema = z.object({
  attemptId: z.string().min(1),
  sessionId: z.string().min(1),
  worktree: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  baseSha: z.string(),
  headSha: z.string(),
  status: z.enum(['running', 'waiting-review', 'completed', 'failed']),
  lease: z.object({
    state: z.enum(['active', 'released', 'expired']),
    fencingToken: z.number().int().positive(),
    claimedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  }),
})
const itemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  kind: z.enum(['contract', 'implementation', 'integration']),
  wave: z.number().int().nonnegative(),
  lifecycle: z.enum(['planned', 'active', 'review', 'done']),
  humanOwner: z.string(),
  interfaces: z.array(z.object({ name: z.string().min(1), usage: z.string().min(1) })),
  expectedPaths: z.array(z.string()),
  issue: issueSchema,
  primaryPr: pullRequestSchema,
  agent: z.string().optional(),
  execution: executionSchema.optional(),
})
const dependencySchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: z.enum(['contract', 'requires', 'integrate-with']),
})
const dagDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: z.literal('dag'),
  name: z.string().min(1),
  repository: z.string().regex(/^[^/]+\/[^/]+$/),
  remote: z.string().min(1),
  defaultBranch: z.string().min(1),
  revision: z.number().int().nonnegative(),
  lastGithubSyncAt: z.string().datetime().optional(),
  items: z.array(itemSchema).min(1),
  dependencies: z.array(dependencySchema),
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
})

export function createDemoDag(dagId: string = DEFAULT_DEMO_DAG_ID): DagDocument {
  const catalogItem = getDemoDag(dagId)
  return {
    schemaVersion: 1,
    id: dagId,
    kind: 'dag',
    name: catalogItem?.name ?? 'Untitled PR DAG',
    repository: catalogItem?.repository ?? 'ActivePeter/sim',
    remote: 'fork',
    defaultBranch: 'main',
    revision: 1,
    items: createDemoPlanItems(),
    dependencies: PLAN_DEPENDENCIES.map((dependency) => ({ ...dependency })),
    positions: structuredClone(INITIAL_PLAN_POSITIONS),
  }
}

export function parseDagDocument(content: string): DagDocument {
  return dagDocumentSchema.parse(JSON.parse(content))
}

export function serializeDagDocument(document: DagDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function createDemoPlanItems(): PlanItem[] {
  return INITIAL_PLAN_ITEMS.map((item) => structuredClone(item))
}

export function getPlanFileName(dagId: string): string {
  return `sim-plan-${dagId}.json`
}

export function getNextDagItemId(items: readonly PlanItem[]): string {
  const nextNumber =
    items.reduce((highest, item) => {
      const match = /^PG-(\d+)$/.exec(item.id)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0) + 1
  return `PG-${String(nextNumber).padStart(2, '0')}`
}

export function addDagItem(document: DagDocument, itemId: string): DagDocument {
  if (document.items.some((item) => item.id === itemId)) return document
  const wave = Math.max(0, ...document.items.map((item) => item.wave))
  const itemsInWave = document.items.filter((item) => item.wave === wave).length
  const item: PlanItem = {
    id: itemId,
    title: 'Untitled DAG item',
    summary: 'Describe the outcome this node must deliver before its dependents can proceed.',
    kind: 'implementation',
    wave,
    lifecycle: 'planned',
    humanOwner: 'Unassigned',
    interfaces: [{ name: 'New interface', usage: 'Show the smallest valid call here.' }],
    expectedPaths: [],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  }
  return {
    ...document,
    revision: document.revision + 1,
    items: [...document.items, item],
    positions: {
      ...document.positions,
      [itemId]: { x: 40 + wave * 340, y: 80 + itemsInWave * 250 },
    },
  }
}

export function updateDagItem(
  document: DagDocument,
  itemId: string,
  update: DagItemUpdate
): DagDocument {
  const currentItem = document.items.find((item) => item.id === itemId)
  if (!currentItem) return document
  const issue =
    update.issueNumber === undefined
      ? currentItem.issue
      : update.issueNumber === null
        ? { number: null, state: 'Unknown' as const }
        : { ...currentItem.issue, number: update.issueNumber }
  const primaryPr =
    update.primaryPrNumber === undefined
      ? currentItem.primaryPr
      : update.primaryPrNumber === null
        ? {
            number: null,
            state: 'Unopened' as const,
            checks: 'Pending' as const,
            review: 'Pending' as const,
          }
        : {
            ...currentItem.primaryPr,
            number: update.primaryPrNumber,
            state:
              currentItem.primaryPr.state === 'Unopened'
                ? ('Draft' as const)
                : currentItem.primaryPr.state,
          }
  const nextItem: PlanItem = {
    ...currentItem,
    title: update.title ?? currentItem.title,
    summary: update.summary ?? currentItem.summary,
    humanOwner: update.humanOwner ?? currentItem.humanOwner,
    issue,
    primaryPr,
    execution: currentItem.execution
      ? {
          ...currentItem.execution,
          branch: update.executionBranch ?? currentItem.execution.branch,
          worktree: update.executionWorktree ?? currentItem.execution.worktree,
        }
      : undefined,
  }
  if (JSON.stringify(nextItem) === JSON.stringify(currentItem)) return document
  return {
    ...document,
    revision: document.revision + 1,
    items: document.items.map((item) => (item.id === itemId ? nextItem : item)),
  }
}

export function removeDagItem(document: DagDocument, itemId: string): DagDocument {
  if (!document.items.some((item) => item.id === itemId)) return document
  const positions = { ...document.positions }
  delete positions[itemId]
  return {
    ...document,
    revision: document.revision + 1,
    items: document.items.filter((item) => item.id !== itemId),
    dependencies: document.dependencies.filter(
      (dependency) => dependency.source !== itemId && dependency.target !== itemId
    ),
    positions,
  }
}

export function wouldCreateDagCycle(
  dependencies: readonly PlanDependency[],
  source: string,
  target: string
): boolean {
  if (source === target) return true
  const targetsBySource = new Map<string, string[]>()
  for (const dependency of dependencies) {
    const targets = targetsBySource.get(dependency.source) ?? []
    targets.push(dependency.target)
    targetsBySource.set(dependency.source, targets)
  }
  const pending = [target]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current)) continue
    if (current === source) return true
    visited.add(current)
    pending.push(...(targetsBySource.get(current) ?? []))
  }
  return false
}

export function addDagDependency(document: DagDocument, dependency: PlanDependency): DagDocument {
  const itemIds = new Set(document.items.map((item) => item.id))
  const duplicate = document.dependencies.some(
    (candidate) => candidate.source === dependency.source && candidate.target === dependency.target
  )
  if (
    !itemIds.has(dependency.source) ||
    !itemIds.has(dependency.target) ||
    duplicate ||
    wouldCreateDagCycle(document.dependencies, dependency.source, dependency.target)
  ) {
    return document
  }
  return {
    ...document,
    revision: document.revision + 1,
    dependencies: [...document.dependencies, dependency],
  }
}

export function updateDagDependencyKind(
  document: DagDocument,
  dependencyId: string,
  kind: PlanDependencyKind
): DagDocument {
  const dependency = document.dependencies.find((candidate) => candidate.id === dependencyId)
  if (!dependency || dependency.kind === kind) return document
  return {
    ...document,
    revision: document.revision + 1,
    dependencies: document.dependencies.map((candidate) =>
      candidate.id === dependencyId ? { ...candidate, kind } : candidate
    ),
  }
}

export function removeDagDependency(document: DagDocument, dependencyId: string): DagDocument {
  if (!document.dependencies.some((dependency) => dependency.id === dependencyId)) return document
  return {
    ...document,
    revision: document.revision + 1,
    dependencies: document.dependencies.filter((dependency) => dependency.id !== dependencyId),
  }
}

export function getBlockingItemIds(
  itemId: string,
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES
): string[] {
  const itemById = new Map(items.map((item) => [item.id, item]))
  return dependencies
    .filter((dependency) => dependency.target === itemId)
    .filter((dependency) => dependency.kind !== 'integrate-with')
    .filter((dependency) => itemById.get(dependency.source)?.lifecycle !== 'done')
    .map((dependency) => dependency.source)
}

export function getMergeBlockingItemIds(
  itemId: string,
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES
): string[] {
  const itemById = new Map(items.map((item) => [item.id, item]))
  return dependencies
    .filter((dependency) => dependency.target === itemId)
    .filter((dependency) => itemById.get(dependency.source)?.lifecycle !== 'done')
    .map((dependency) => dependency.source)
}

function hasExpiredLease(item: PlanItem, now: Date): boolean {
  return Boolean(
    item.execution?.lease.state === 'active' &&
      new Date(item.execution.lease.expiresAt).getTime() <= now.getTime()
  )
}

export function resolvePlanLifecycle(
  item: PlanItem,
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES,
  now: Date = new Date()
): PlanLifecycle {
  if (item.lifecycle === 'active' && hasExpiredLease(item, now)) return 'ready'
  if (item.lifecycle !== 'planned') return item.lifecycle
  return getBlockingItemIds(item.id, items, dependencies).length === 0 ? 'ready' : 'blocked'
}

export function resolvePlanItems(
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES,
  now: Date = new Date()
): ResolvedPlanItem[] {
  return items.map((item) => ({
    ...item,
    resolvedLifecycle: resolvePlanLifecycle(item, items, dependencies, now),
    blockerIds: getBlockingItemIds(item.id, items, dependencies),
  }))
}

export function getPlanCounts(items: readonly ResolvedPlanItem[]): PlanCounts {
  const counts: PlanCounts = {
    active: 0,
    blocked: 0,
    done: 0,
    ready: 0,
    review: 0,
    total: items.length,
  }
  for (const item of items) {
    if (item.resolvedLifecycle === 'active') counts.active += 1
    if (item.resolvedLifecycle === 'blocked') counts.blocked += 1
    if (item.resolvedLifecycle === 'done') counts.done += 1
    if (item.resolvedLifecycle === 'ready') counts.ready += 1
    if (item.resolvedLifecycle === 'review') counts.review += 1
  }
  return counts
}

export function getNextReadyItem(
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES,
  now: Date = new Date()
): PlanItem | undefined {
  return items.find((item) => resolvePlanLifecycle(item, items, dependencies, now) === 'ready')
}

export function claimDagItem(
  document: DagDocument,
  itemId: string,
  claim: PlanClaimInput
): DagDocument {
  const item = document.items.find((candidate) => candidate.id === itemId)
  const now = new Date(claim.claimedAt)
  if (!item || resolvePlanLifecycle(item, document.items, document.dependencies, now) !== 'ready') {
    return document
  }
  const fencingToken =
    Math.max(
      0,
      ...document.items.map((candidate) => candidate.execution?.lease.fencingToken ?? 0)
    ) + 1
  return {
    ...document,
    revision: document.revision + 1,
    items: document.items.map((candidate) =>
      candidate.id === itemId
        ? {
            ...candidate,
            lifecycle: 'active',
            agent: claim.agent,
            execution: {
              attemptId: claim.attemptId,
              sessionId: claim.sessionId,
              worktree: claim.worktree,
              branch: claim.branch,
              baseBranch: document.defaultBranch,
              baseSha: claim.baseSha,
              headSha: 'working',
              status: 'running',
              lease: {
                state: 'active',
                fencingToken,
                claimedAt: claim.claimedAt,
                expiresAt: claim.expiresAt,
              },
            },
          }
        : candidate
    ),
  }
}

export function applyGitHubBindingUpdates(
  document: DagDocument,
  updates: readonly GitHubBindingUpdate[],
  syncedAt: string
): DagDocument {
  const updatesById = new Map(updates.map((update) => [update.itemId, update]))
  let changed = document.lastGithubSyncAt !== syncedAt
  const items = document.items.map((item) => {
    const update = updatesById.get(item.id)
    if (!update) return item
    const issue = update.issue ?? item.issue
    const primaryPr = update.primaryPr ?? item.primaryPr
    let lifecycle = item.lifecycle
    let execution = item.execution
    if (primaryPr.state === 'Merged') {
      lifecycle = 'done'
      execution = execution
        ? {
            ...execution,
            headSha: primaryPr.headSha ?? execution.headSha,
            status: 'completed',
            lease: { ...execution.lease, state: 'released' },
          }
        : undefined
    } else if (primaryPr.state === 'Open') {
      lifecycle = 'review'
      execution = execution
        ? {
            ...execution,
            headSha: primaryPr.headSha ?? execution.headSha,
            status: 'waiting-review',
            lease: { ...execution.lease, state: 'released' },
          }
        : undefined
    } else if (primaryPr.state === 'Draft' && lifecycle === 'planned') {
      lifecycle = 'active'
    }
    const next = { ...item, issue, primaryPr, lifecycle, execution }
    if (JSON.stringify(next) !== JSON.stringify(item)) changed = true
    return next
  })
  if (!changed) return document
  return { ...document, revision: document.revision + 1, lastGithubSyncAt: syncedAt, items }
}

export function isDependencySatisfied(
  dependency: PlanDependency,
  items: readonly PlanItem[]
): boolean {
  return items.find((item) => item.id === dependency.source)?.lifecycle === 'done'
}
