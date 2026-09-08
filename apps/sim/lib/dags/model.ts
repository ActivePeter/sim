import { z } from 'zod'
import type { CanvasDocumentKind } from '@/lib/canvas/types'

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
  localRepositoryPath?: string
  repository?: string
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

export interface PlanSize {
  height: number
  width: number
}

export const DEFAULT_PLAN_NODE_SIZE: Readonly<PlanSize> = {
  height: 212,
  width: 250,
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
  sizes: Record<string, PlanSize>
}

export interface DagItemUpdate {
  executionBranch?: string
  executionWorktree?: string
  humanOwner?: string
  issueNumber?: number | null
  localRepositoryPath?: string | null
  primaryPrNumber?: number | null
  repository?: string
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
  repositoryRoot?: string
  sessionId: string
  worktree: string
}

export interface GitHubBindingUpdate {
  itemId: string
  issue?: PlanIssueBinding
  primaryPr?: PlanPullRequestBinding
}

export const dagIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'Invalid DAG ID')

export const MAX_DAG_CONTENT_BYTES = 1024 * 1024

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
  localRepositoryPath: z.string().min(1).optional(),
  repository: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .optional(),
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
export const dagDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: dagIdSchema,
    kind: z.literal('dag'),
    name: z.string().min(1).max(200),
    repository: z.string().regex(/^[^/]+\/[^/]+$/),
    remote: z.string().min(1),
    defaultBranch: z.string().min(1),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lastGithubSyncAt: z.string().datetime().optional(),
    items: z.array(itemSchema).max(2_000),
    dependencies: z.array(dependencySchema).max(10_000),
    positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
    sizes: z
      .record(
        z.string(),
        z.object({
          height: z.number().positive(),
          width: z.number().positive(),
        })
      )
      .default({}),
  })
  .superRefine((document, context) => {
    const ids = new Set(document.items.map((item) => item.id))
    const edges = new Set<string>()
    const pairs = new Set<string>()
    const targetsBySource = new Map<string, string[]>()
    const incomingCounts = new Map([...ids].map((id) => [id, 0]))
    if (ids.size !== document.items.length) {
      context.addIssue({ code: 'custom', path: ['items'], message: 'DAG node IDs must be unique' })
    }
    for (const [index, dependency] of document.dependencies.entries()) {
      const pair = JSON.stringify([dependency.source, dependency.target])
      if (
        !ids.has(dependency.source) ||
        !ids.has(dependency.target) ||
        edges.has(dependency.id) ||
        pairs.has(pair)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index],
          message: 'DAG dependencies must reference existing nodes and be unique',
        })
        continue
      }
      edges.add(dependency.id)
      pairs.add(pair)
      const targets = targetsBySource.get(dependency.source) ?? []
      targets.push(dependency.target)
      targetsBySource.set(dependency.source, targets)
      incomingCounts.set(dependency.target, (incomingCounts.get(dependency.target) ?? 0) + 1)
    }
    const ready = [...ids].filter((id) => incomingCounts.get(id) === 0)
    let visited = 0
    for (let index = 0; index < ready.length; index += 1) {
      visited += 1
      for (const target of targetsBySource.get(ready[index]) ?? []) {
        const remaining = (incomingCounts.get(target) ?? 0) - 1
        incomingCounts.set(target, remaining)
        if (remaining === 0) ready.push(target)
      }
    }
    if (visited !== ids.size) {
      context.addIssue({
        code: 'custom',
        path: ['dependencies'],
        message: 'DAG dependencies must be acyclic',
      })
    }
  })

/** Creates an empty document only from an explicit creation request. */
export function createDagDocument(
  input: Pick<DagDocument, 'id' | 'name' | 'repository' | 'remote' | 'defaultBranch'>
): DagDocument {
  return {
    ...input,
    schemaVersion: 1,
    kind: 'dag',
    revision: 1,
    items: [],
    dependencies: [],
    positions: {},
    sizes: {},
  }
}

export function parseDagDocument(content: string): DagDocument {
  return dagDocumentSchema.parse(JSON.parse(content))
}

export function serializeDagDocument(document: DagDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
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

export function addDagItem(document: DagDocument, itemId: string, title: string): DagDocument {
  if (document.items.some((item) => item.id === itemId)) return document
  const wave = Math.max(0, ...document.items.map((item) => item.wave))
  const itemsInWave = document.items.filter((item) => item.wave === wave).length
  const item: PlanItem = {
    id: itemId,
    title,
    summary: '',
    kind: 'implementation',
    wave,
    lifecycle: 'planned',
    humanOwner: '',
    interfaces: [],
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
  let issue =
    update.issueNumber === undefined
      ? currentItem.issue
      : update.issueNumber === null
        ? { number: null, state: 'Unknown' as const }
        : { ...currentItem.issue, number: update.issueNumber }
  let primaryPr =
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
  const repository = update.repository ?? currentItem.repository
  const artifactRepository = repository ?? document.repository
  if (issue.number !== null && (update.repository || update.issueNumber !== undefined)) {
    issue = {
      ...issue,
      url: `https://github.com/${artifactRepository}/issues/${issue.number}`,
    }
  }
  if (primaryPr.number !== null && (update.repository || update.primaryPrNumber !== undefined)) {
    primaryPr = {
      ...primaryPr,
      url: `https://github.com/${artifactRepository}/pull/${primaryPr.number}`,
    }
  }
  const nextItem: PlanItem = {
    ...currentItem,
    title: update.title ?? currentItem.title,
    summary: update.summary ?? currentItem.summary,
    humanOwner: update.humanOwner ?? currentItem.humanOwner,
    localRepositoryPath:
      update.localRepositoryPath === undefined
        ? currentItem.localRepositoryPath
        : (update.localRepositoryPath ?? undefined),
    repository,
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

export function removeDagItems(document: DagDocument, itemIds: readonly string[]): DagDocument {
  const requestedItemIds = new Set(itemIds)
  const existingItemIds = new Set(
    document.items.filter((item) => requestedItemIds.has(item.id)).map((item) => item.id)
  )
  if (existingItemIds.size === 0) return document

  const positions = { ...document.positions }
  const sizes = { ...document.sizes }
  for (const itemId of existingItemIds) {
    delete positions[itemId]
    delete sizes[itemId]
  }

  return {
    ...document,
    revision: document.revision + 1,
    items: document.items.filter((item) => !existingItemIds.has(item.id)),
    dependencies: document.dependencies.filter(
      (dependency) =>
        !existingItemIds.has(dependency.source) && !existingItemIds.has(dependency.target)
    ),
    positions,
    sizes,
  }
}

export function removeDagItem(document: DagDocument, itemId: string): DagDocument {
  return removeDagItems(document, [itemId])
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
  dependencies: readonly PlanDependency[]
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
  dependencies: readonly PlanDependency[]
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
  dependencies: readonly PlanDependency[],
  now: Date = new Date()
): PlanLifecycle {
  if (item.lifecycle === 'active' && hasExpiredLease(item, now)) return 'ready'
  if (item.lifecycle !== 'planned') return item.lifecycle
  return getBlockingItemIds(item.id, items, dependencies).length === 0 ? 'ready' : 'blocked'
}

export function resolvePlanItems(
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[],
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
  dependencies: readonly PlanDependency[],
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
            localRepositoryPath: claim.repositoryRoot ?? candidate.localRepositoryPath,
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
