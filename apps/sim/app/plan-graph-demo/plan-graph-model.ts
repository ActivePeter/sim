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
  height: 156,
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
    title: '自举 Plan Graph MVP',
    summary:
      '持久化 Sim 自己的开发路线，原子化认领任务，同步真实 Pull Request，并向 Agent 交付可执行的 worktree 任务说明。',
    kind: 'implementation',
    wave: 0,
    lifecycle: 'planned',
    humanOwner: 'Peter',
    interfaces: [
      {
        name: '计划文档 CAS',
        usage: '使用最新读取结果中的 expectedContentUpdatedAt，以 PUT 方式更新文件内容。',
      },
      {
        name: 'Agent 节点认领',
        usage:
          'bun .agents/skills/plan-node/scripts/plan-node.ts claim --node PG-01 --agent codex-01',
      },
      {
        name: 'GitHub 状态同步',
        usage: '点击“同步 GitHub”，刷新 Issue、PR、检查、评审和合并状态。',
      },
      {
        name: 'Latest 试用服务',
        usage: 'bun run deploy:sim:latest → http://<host>:3300/plan-graph-demo',
      },
      {
        name: '固定快照服务',
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
    title: 'Agent 环境提供器',
    summary: '将已接受的认领转换为隔离的 worktree、分支、会话、心跳和可恢复执行尝试。',
    kind: 'implementation',
    wave: 1,
    lifecycle: 'planned',
    humanOwner: '未分配',
    interfaces: [
      {
        name: '环境创建',
        usage: 'provision({ repository, branch, baseSha, attemptId }) → { worktree }',
      },
      {
        name: '租约心跳',
        usage: 'heartbeat({ nodeId, attemptId, fencingToken })',
      },
    ],
    expectedPaths: ['packages/plan-runtime', 'apps/sim/lib/plan-runtime'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-03',
    title: '持久化 GitHub 事件同步',
    summary: '用带认证的同步、幂等 webhook、投递游标和漂移检测替代手动公开轮询。',
    kind: 'integration',
    wave: 1,
    lifecycle: 'planned',
    humanOwner: '未分配',
    interfaces: [
      {
        name: '仓库快照',
        usage: 'reconcile({ repository, issue, pullRequest, lastExternalVersion })',
      },
      {
        name: 'Webhook 接收',
        usage: 'ingest({ deliveryId, event, payload })',
      },
    ],
    expectedPaths: ['apps/sim/lib/plan-github', 'apps/sim/app/api/webhooks/github'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-04',
    title: '专用计划持久化与实时协作',
    summary: '将工作区文件 MVP 演进为 Plan Space 数据表、版本事件、在线状态和协作式图投影。',
    kind: 'implementation',
    wave: 1,
    lifecycle: 'planned',
    humanOwner: '未分配',
    interfaces: [
      {
        name: '计划存储库',
        usage: 'saveRevision({ planId, expectedRevision, graph })',
      },
      {
        name: '计划事件流',
        usage: 'subscribe({ planId, afterCursor })',
      },
    ],
    expectedPaths: ['packages/plan-persistence', 'apps/realtime'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-05',
    title: '父提交 SHA 与合并屏障',
    summary: '检测过期的堆叠分支，展示“需要同步”，并执行依赖感知的评审与合并门禁。',
    kind: 'contract',
    wave: 2,
    lifecycle: 'planned',
    humanOwner: '未分配',
    interfaces: [
      {
        name: '合并决策',
        usage: 'evaluateMerge({ node, prerequisites, githubSnapshot }) → blockers[]',
      },
    ],
    expectedPaths: ['packages/plan-policy', 'apps/sim/lib/plan-policy'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-06',
    title: '扇出/汇合自举验证',
    summary: '让两个 Agent 在独立分支并行工作，通过集成门禁汇合，并在重启后恢复整张图。',
    kind: 'integration',
    wave: 3,
    lifecycle: 'planned',
    humanOwner: 'Peter',
    interfaces: [
      {
        name: '自举验收',
        usage: 'A → (B, C) → D 使用不同的执行尝试、worktree、PR 和检查并完成。',
      },
    ],
    expectedPaths: ['apps/sim/app/plan-graph', 'apps/sim/e2e/plan-graph'],
    issue: { number: null, state: 'Unknown' },
    primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
  },
  {
    id: 'PG-07',
    title: '可复用的 Codex 编码 Agent 工作流',
    summary:
      '在隔离沙箱中运行可复用的 Codex 编码 Agent，跨工作流步骤输出实现计划或持续维护 Pull Request。',
    kind: 'implementation',
    wave: 0,
    lifecycle: 'review',
    humanOwner: 'Peter',
    repository: 'simstudioai/sim',
    interfaces: [
      {
        name: 'Codex 工作流节点',
        usage: '在工作流中添加 Codex，输入任务，然后选择“规划”或“创建 PR”。',
      },
      {
        name: '可复用 Agent 会话',
        usage: '在多个 Codex 节点中选择同一个 Agent，复用其沙箱、代码检出和原生线程。',
      },
      {
        name: '分层配置',
        usage: '先设置工作区默认值，按需在工作流或 Agent 层覆盖，仅在必要时使用步骤级覆盖。',
      },
    ],
    expectedPaths: [
      'apps/sim/blocks/blocks/codex.ts',
      'apps/sim/executor/handlers/codex',
      'apps/sim/components/codex',
      'apps/sim/lib/codex',
      'apps/sim/hooks/use-agent-session-catalog.ts',
      'packages/db/migrations/0310_codex_configuration_layers.sql',
    ],
    issue: { number: null, state: 'Unknown' },
    primaryPr: {
      number: 7205,
      state: 'Open',
      checks: 'Failed',
      review: 'Pending',
      url: 'https://github.com/simstudioai/sim/pull/7205',
      baseSha: 'a042b8ffad812f1b365a63d56a943e1109791dcd',
      headSha: 'fa1b75c4566657fbf5c40dfd160e8a72b08c21b2',
      mergeable: false,
    },
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
  'PG-07': { x: 40, y: 560 },
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

export function createDemoDag(dagId: string = DEFAULT_DEMO_DAG_ID): DagDocument {
  const catalogItem = getDemoDag(dagId)
  return {
    schemaVersion: 1,
    id: dagId,
    kind: 'dag',
    name: catalogItem?.name ?? '未命名 PR DAG',
    repository: catalogItem?.repository ?? 'ActivePeter/sim',
    remote: 'fork',
    defaultBranch: 'main',
    revision: 1,
    items: createDemoPlanItems(),
    dependencies: PLAN_DEPENDENCIES.map((dependency) => ({ ...dependency })),
    positions: structuredClone(INITIAL_PLAN_POSITIONS),
    sizes: {},
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
    title: '未命名 DAG 节点',
    summary: '描述该节点必须交付的结果，以及后续节点开始前需要满足的条件。',
    kind: 'implementation',
    wave,
    lifecycle: 'planned',
    humanOwner: '未分配',
    interfaces: [{ name: '新接口', usage: '在此给出最简单的有效用法。' }],
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

export function removeDagItem(document: DagDocument, itemId: string): DagDocument {
  if (!document.items.some((item) => item.id === itemId)) return document
  const positions = { ...document.positions }
  const sizes = { ...document.sizes }
  delete positions[itemId]
  delete sizes[itemId]
  return {
    ...document,
    revision: document.revision + 1,
    items: document.items.filter((item) => item.id !== itemId),
    dependencies: document.dependencies.filter(
      (dependency) => dependency.source !== itemId && dependency.target !== itemId
    ),
    positions,
    sizes,
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
