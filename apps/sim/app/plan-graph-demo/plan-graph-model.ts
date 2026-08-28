import type { CanvasDocumentKind } from '@/lib/canvas/types'

export type StoredPlanLifecycle = 'planned' | 'active' | 'review' | 'done'
export type PlanLifecycle = StoredPlanLifecycle | 'ready' | 'blocked'
export type PlanNodeKind = 'contract' | 'implementation' | 'integration'
export type PlanDependencyKind = 'contract' | 'requires' | 'integrate-with'
export type PullRequestState = 'Pending' | 'Draft' | 'Open' | 'Merged'
export type CheckState = 'Pending' | 'Running' | 'Passed'
export type ReviewState = 'Pending' | 'Approved'

export interface PlanIssueBinding {
  number: number
  state: 'Open' | 'Closed'
}

export interface PlanPullRequestBinding {
  number: number
  state: PullRequestState
  checks: CheckState
  review: ReviewState
}

export interface PlanExecution {
  sessionId: string
  worktree: string
  branch: string
  baseSha: string
  headSha: string
  status: 'running' | 'waiting-review' | 'completed'
  lease: 'active' | 'released'
}

export interface PlanItem {
  id: string
  title: string
  summary: string
  kind: PlanNodeKind
  wave: number
  lifecycle: StoredPlanLifecycle
  humanOwner: string
  authorityScope: string[]
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

export interface RoadmapDocument {
  dependencies: PlanDependency[]
  id: string
  items: PlanItem[]
  kind: Extract<CanvasDocumentKind, 'roadmap'>
  name: string
  positions: Record<string, PlanPosition>
  revision: number
}

export interface RoadmapItemUpdate {
  humanOwner?: string
  issueNumber?: number
  primaryPrNumber?: number
  summary?: string
  title?: string
}

export const DEMO_AGENTS = ['Codex 01', 'Codex 02', 'Claude 01'] as const

const INITIAL_PLAN_ITEMS: readonly PlanItem[] = [
  {
    id: 'PG-01',
    title: 'Session identity contract',
    summary:
      'Define stable session identity, lifecycle states, ownership boundaries, and provider-neutral contracts.',
    kind: 'contract',
    wave: 0,
    lifecycle: 'done',
    humanOwner: 'Peter',
    authorityScope: ['Session ID', 'Lifecycle enum', 'Ownership map'],
    expectedPaths: ['packages/plan-types', 'lib/session-contract'],
    issue: { number: 2, state: 'Closed' },
    primaryPr: {
      number: 18,
      state: 'Merged',
      checks: 'Passed',
      review: 'Approved',
    },
    agent: 'Codex 01',
    execution: {
      sessionId: 'sess-contract-01',
      worktree: '/worktrees/pg-01-contract',
      branch: 'plan/demo/pg-01-session-contract',
      baseSha: 'a042b8f',
      headSha: '7b31d6f',
      status: 'completed',
      lease: 'released',
    },
  },
  {
    id: 'PG-02',
    title: 'Durable session store',
    summary:
      'Persist sessions, event cursors, recovery checkpoints, and authoritative remote state.',
    kind: 'implementation',
    wave: 1,
    lifecycle: 'planned',
    humanOwner: 'Peter',
    authorityScope: ['Session repository', 'Event cursor', 'Recovery checkpoint'],
    expectedPaths: ['packages/db', 'lib/session-store'],
    issue: { number: 3, state: 'Open' },
    primaryPr: {
      number: 22,
      state: 'Draft',
      checks: 'Pending',
      review: 'Pending',
    },
  },
  {
    id: 'PG-03',
    title: 'Message queue and run state',
    summary:
      'Queue follow-up messages while an Agent is running and expose deterministic run transitions.',
    kind: 'implementation',
    wave: 2,
    lifecycle: 'planned',
    humanOwner: 'Mina',
    authorityScope: ['Message queue', 'Run transition policy'],
    expectedPaths: ['lib/session-queue', 'stores/session-runs'],
    issue: { number: 4, state: 'Open' },
    primaryPr: {
      number: 24,
      state: 'Pending',
      checks: 'Pending',
      review: 'Pending',
    },
  },
  {
    id: 'PG-04',
    title: 'Change set and test results',
    summary:
      'Attach changed files, reviewable diffs, focused tests, and acceptance decisions to a session.',
    kind: 'implementation',
    wave: 2,
    lifecycle: 'planned',
    humanOwner: 'Mina',
    authorityScope: ['Change set projection', 'Validation result'],
    expectedPaths: ['lib/change-sets', 'components/diff-review'],
    issue: { number: 5, state: 'Open' },
    primaryPr: {
      number: 25,
      state: 'Pending',
      checks: 'Pending',
      review: 'Pending',
    },
  },
  {
    id: 'PG-05',
    title: 'Document to Agent entry',
    summary:
      'Create an Agent Session from a document selection with project, workspace, file, and Git context.',
    kind: 'integration',
    wave: 3,
    lifecycle: 'planned',
    humanOwner: 'Peter',
    authorityScope: ['Document context handoff'],
    expectedPaths: ['components/document-actions', 'lib/session-entry'],
    issue: { number: 6, state: 'Open' },
    primaryPr: {
      number: 27,
      state: 'Pending',
      checks: 'Pending',
      review: 'Pending',
    },
  },
  {
    id: 'PG-06',
    title: 'Fullscreen session panel',
    summary:
      'Show running, waiting, failed, and completed sessions with their diffs and validation state.',
    kind: 'integration',
    wave: 3,
    lifecycle: 'planned',
    humanOwner: 'Peter',
    authorityScope: ['Session catalog projection', 'Plan status summary'],
    expectedPaths: ['app/plan-graph', 'components/session-panel'],
    issue: { number: 7, state: 'Open' },
    primaryPr: {
      number: 28,
      state: 'Pending',
      checks: 'Pending',
      review: 'Pending',
    },
  },
]

export const PLAN_DEPENDENCIES: readonly PlanDependency[] = [
  { id: 'edge-01-02', source: 'PG-01', target: 'PG-02', kind: 'contract' },
  { id: 'edge-02-03', source: 'PG-02', target: 'PG-03', kind: 'requires' },
  { id: 'edge-02-04', source: 'PG-02', target: 'PG-04', kind: 'requires' },
  { id: 'edge-03-05', source: 'PG-03', target: 'PG-05', kind: 'requires' },
  { id: 'edge-03-06', source: 'PG-03', target: 'PG-06', kind: 'requires' },
  { id: 'edge-04-06', source: 'PG-04', target: 'PG-06', kind: 'integrate-with' },
]

export function createDemoRoadmap(): RoadmapDocument {
  return {
    id: 'roadmap-agent-sessions',
    kind: 'roadmap',
    name: 'Agent Roadmap',
    revision: 7,
    items: createDemoPlanItems(),
    dependencies: PLAN_DEPENDENCIES.map((dependency) => ({ ...dependency })),
    positions: structuredClone(INITIAL_PLAN_POSITIONS),
  }
}

export const INITIAL_PLAN_POSITIONS: Readonly<Record<string, PlanPosition>> = {
  'PG-01': { x: 40, y: 250 },
  'PG-02': { x: 360, y: 250 },
  'PG-03': { x: 690, y: 80 },
  'PG-04': { x: 690, y: 420 },
  'PG-05': { x: 1020, y: 80 },
  'PG-06': { x: 1020, y: 330 },
}

export function createDemoPlanItems(): PlanItem[] {
  return INITIAL_PLAN_ITEMS.map((item) => ({
    ...item,
    authorityScope: [...item.authorityScope],
    expectedPaths: [...item.expectedPaths],
    issue: { ...item.issue },
    primaryPr: { ...item.primaryPr },
    execution: item.execution ? { ...item.execution } : undefined,
  }))
}

export function getNextRoadmapItemId(items: readonly PlanItem[]): string {
  const nextNumber =
    items.reduce((highest, item) => {
      const match = /^PG-(\d+)$/.exec(item.id)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0) + 1

  return `PG-${String(nextNumber).padStart(2, '0')}`
}

export function addRoadmapItem(document: RoadmapDocument, itemId: string): RoadmapDocument {
  if (document.items.some((item) => item.id === itemId)) return document

  const wave = Math.max(0, ...document.items.map((item) => item.wave))
  const itemsInWave = document.items.filter((item) => item.wave === wave).length
  const issueNumber = Math.max(0, ...document.items.map((item) => item.issue.number)) + 1
  const primaryPrNumber = Math.max(0, ...document.items.map((item) => item.primaryPr.number)) + 1
  const item: PlanItem = {
    id: itemId,
    title: 'Untitled roadmap item',
    summary: 'Describe the outcome this node must deliver before its dependents can proceed.',
    kind: 'implementation',
    wave,
    lifecycle: 'planned',
    humanOwner: 'Unassigned',
    authorityScope: ['Define authority scope'],
    expectedPaths: [],
    issue: { number: issueNumber, state: 'Open' },
    primaryPr: {
      number: primaryPrNumber,
      state: 'Pending',
      checks: 'Pending',
      review: 'Pending',
    },
  }

  return {
    ...document,
    revision: document.revision + 1,
    items: [...document.items, item],
    positions: {
      ...document.positions,
      [itemId]: { x: 40 + wave * 330, y: 80 + itemsInWave * 250 },
    },
  }
}

export function updateRoadmapItem(
  document: RoadmapDocument,
  itemId: string,
  update: RoadmapItemUpdate
): RoadmapDocument {
  const currentItem = document.items.find((item) => item.id === itemId)
  if (!currentItem) return document

  const nextItem: PlanItem = {
    ...currentItem,
    title: update.title ?? currentItem.title,
    summary: update.summary ?? currentItem.summary,
    humanOwner: update.humanOwner ?? currentItem.humanOwner,
    issue:
      update.issueNumber === undefined
        ? currentItem.issue
        : { ...currentItem.issue, number: update.issueNumber },
    primaryPr:
      update.primaryPrNumber === undefined
        ? currentItem.primaryPr
        : { ...currentItem.primaryPr, number: update.primaryPrNumber },
  }

  if (
    nextItem.title === currentItem.title &&
    nextItem.summary === currentItem.summary &&
    nextItem.humanOwner === currentItem.humanOwner &&
    nextItem.issue.number === currentItem.issue.number &&
    nextItem.primaryPr.number === currentItem.primaryPr.number
  ) {
    return document
  }

  return {
    ...document,
    revision: document.revision + 1,
    items: document.items.map((item) => (item.id === itemId ? nextItem : item)),
  }
}

export function removeRoadmapItem(document: RoadmapDocument, itemId: string): RoadmapDocument {
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

export function wouldCreateRoadmapCycle(
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

export function addRoadmapDependency(
  document: RoadmapDocument,
  dependency: PlanDependency
): RoadmapDocument {
  const itemIds = new Set(document.items.map((item) => item.id))
  const duplicate = document.dependencies.some(
    (candidate) => candidate.source === dependency.source && candidate.target === dependency.target
  )
  if (
    !itemIds.has(dependency.source) ||
    !itemIds.has(dependency.target) ||
    duplicate ||
    wouldCreateRoadmapCycle(document.dependencies, dependency.source, dependency.target)
  ) {
    return document
  }

  return {
    ...document,
    revision: document.revision + 1,
    dependencies: [...document.dependencies, dependency],
  }
}

export function updateRoadmapDependencyKind(
  document: RoadmapDocument,
  dependencyId: string,
  kind: PlanDependencyKind
): RoadmapDocument {
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

export function removeRoadmapDependency(
  document: RoadmapDocument,
  dependencyId: string
): RoadmapDocument {
  if (!document.dependencies.some((dependency) => dependency.id === dependencyId)) {
    return document
  }

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

export function resolvePlanLifecycle(
  item: PlanItem,
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES
): PlanLifecycle {
  if (item.lifecycle !== 'planned') return item.lifecycle
  return getBlockingItemIds(item.id, items, dependencies).length === 0 ? 'ready' : 'blocked'
}

export function resolvePlanItems(
  items: readonly PlanItem[],
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES
): ResolvedPlanItem[] {
  return items.map((item) => ({
    ...item,
    resolvedLifecycle: resolvePlanLifecycle(item, items, dependencies),
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
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES
): PlanItem | undefined {
  return items.find((item) => resolvePlanLifecycle(item, items, dependencies) === 'ready')
}

export function advancePlanItem(
  items: readonly PlanItem[],
  itemId: string,
  agent: string,
  dependencies: readonly PlanDependency[] = PLAN_DEPENDENCIES
): PlanItem[] {
  const item = items.find((candidate) => candidate.id === itemId)
  if (!item) return [...items]

  const resolvedLifecycle = resolvePlanLifecycle(item, items, dependencies)
  if (!['ready', 'active', 'review'].includes(resolvedLifecycle)) return [...items]
  if (
    resolvedLifecycle === 'review' &&
    getMergeBlockingItemIds(itemId, items, dependencies).length > 0
  ) {
    return [...items]
  }

  return items.map((candidate) => {
    if (candidate.id !== itemId) return candidate

    if (resolvedLifecycle === 'ready') {
      return {
        ...candidate,
        lifecycle: 'active',
        agent,
        primaryPr: {
          ...candidate.primaryPr,
          state: 'Draft',
          checks: 'Running',
          review: 'Pending',
        },
        execution: {
          sessionId: `sess-${candidate.id.toLowerCase()}`,
          worktree: `/worktrees/${candidate.id.toLowerCase()}`,
          branch: `plan/demo/${candidate.id.toLowerCase()}`,
          baseSha: '7b31d6f',
          headSha: 'working',
          status: 'running',
          lease: 'active',
        },
      }
    }

    if (resolvedLifecycle === 'active') {
      return {
        ...candidate,
        lifecycle: 'review',
        primaryPr: {
          ...candidate.primaryPr,
          state: 'Open',
          checks: 'Passed',
          review: 'Approved',
        },
        execution: candidate.execution
          ? {
              ...candidate.execution,
              headSha: 'd3f7a2c',
              status: 'waiting-review',
              lease: 'released',
            }
          : undefined,
      }
    }

    return {
      ...candidate,
      lifecycle: 'done',
      issue: { ...candidate.issue, state: 'Closed' },
      primaryPr: {
        ...candidate.primaryPr,
        state: 'Merged',
        checks: 'Passed',
        review: 'Approved',
      },
      execution: candidate.execution
        ? {
            ...candidate.execution,
            status: 'completed',
            lease: 'released',
          }
        : undefined,
    }
  })
}

export function isDependencySatisfied(
  dependency: PlanDependency,
  items: readonly PlanItem[]
): boolean {
  return items.find((item) => item.id === dependency.source)?.lifecycle === 'done'
}
