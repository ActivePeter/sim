import type { DagDocument, PlanDependency, PlanItem, PlanPosition } from '@/lib/dags/model'

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

export function createTestDag(dagId = 'agent-session-prs'): DagDocument {
  return {
    schemaVersion: 1,
    id: dagId,
    kind: 'dag',
    name: 'Sim 自举开发路线',
    repository: 'ActivePeter/sim',
    remote: 'fork',
    defaultBranch: 'main',
    revision: 1,
    items: INITIAL_PLAN_ITEMS.map((item) => structuredClone(item)),
    dependencies: PLAN_DEPENDENCIES.map((dependency) => ({ ...dependency })),
    positions: structuredClone(INITIAL_PLAN_POSITIONS),
    sizes: {},
  }
}
