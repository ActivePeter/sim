import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'

interface TestPlanNode {
  agent?: string
  execution?: { lease: { fencingToken: number; state: string } }
  id: string
  lifecycle: string
  localRepositoryPath?: string
  primaryPr: { checks: string; number: number | null; review: string; state: string }
  summary: string
  title: string
}

interface TestPlan {
  defaultBranch: string
  dependencies: unknown[]
  id: string
  items: TestPlanNode[]
  name: string
  remote: string
  repository: string
  revision: number
  schemaVersion: 1
}

const temporaryPaths: string[] = []

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true })
})

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], { stderr: 'pipe', stdout: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

async function runPlanNode(
  repository: string,
  server: ReturnType<typeof Bun.serve>,
  args: string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const script = resolve(import.meta.dir, '../scripts/plan-node.ts')
  const child = Bun.spawn([globalThis.process.execPath, script, ...args], {
    cwd: repository,
    env: {
      ...globalThis.process.env,
      SIM_API_URL: `http://127.0.0.1:${server.port}`,
      SIM_API_KEY: 'test-key',
      SIM_WORKSPACE_ID: 'workspace-test',
      SIM_PLAN_ID: '',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

describe('plan-node skill script', () => {
  it.each([0, 2])('requires a DAG selection when the database lists %s graphs', async (count) => {
    const paths: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname
        paths.push(path)
        return Response.json({
          data: Array.from({ length: count }, (_, index) => ({ id: `dag-${index}` })),
        })
      },
    })
    try {
      const result = await runPlanNode(process.cwd(), server, ['inspect'])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Set SIM_PLAN_ID')
      expect(paths).toEqual(['/api/v2/dags'])
    } finally {
      server.stop(true)
    }
  })

  it('claims once, provisions an isolated worktree, and binds the PR', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sim-plan-node-'))
    temporaryPaths.push(root)
    const remote = join(root, 'remote.git')
    const repository = join(root, 'sim')
    git(root, ['init', '--bare', remote])
    git(root, ['init', '-b', 'main', repository])
    writeFileSync(join(repository, 'README.md'), '# test\n')
    git(repository, ['config', 'user.email', 'test@example.com'])
    git(repository, ['config', 'user.name', 'Plan Node Test'])
    git(repository, ['add', 'README.md'])
    git(repository, ['commit', '-m', 'test: seed'])
    git(repository, ['remote', 'add', 'fork', remote])
    git(repository, ['push', '-u', 'fork', 'main'])

    let plan: TestPlan = {
      schemaVersion: 1,
      id: 'database-only-plan',
      name: 'Test plan',
      repository: 'example/sim',
      remote: 'fork',
      defaultBranch: 'main',
      revision: 1,
      dependencies: [],
      items: [
        {
          id: 'PG-01',
          title: 'First node',
          summary: 'Deliver the first node.',
          lifecycle: 'planned',
          localRepositoryPath: repository,
          primaryPr: { number: null, state: 'Unopened', checks: 'Pending', review: 'Pending' },
        },
      ],
    }
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method === 'GET' && url.pathname === '/api/v2/dags') {
          return Response.json({
            data: [
              {
                id: plan.id,
                name: plan.name,
                revision: plan.revision,
              },
            ],
          })
        }
        if (request.method === 'GET' && url.pathname === `/api/v2/dags/${plan.id}`) {
          return Response.json({ data: plan })
        }
        if (request.method === 'PUT' && url.pathname === `/api/v2/dags/${plan.id}`) {
          const body = (await request.json()) as {
            document: TestPlan
            expectedRevision: number
          }
          if (body.expectedRevision !== plan.revision) {
            return Response.json(
              { error: { code: 'CONFLICT', message: 'DAG revision conflict' } },
              { status: 409 }
            )
          }
          expect(body.document.revision).toBe(plan.revision + 1)
          plan = body.document
          return Response.json({ data: plan })
        }
        return new Response('not found', { status: 404 })
      },
    })

    try {
      const claimed = await runPlanNode(root, server, [
        'claim',
        '--node',
        'PG-01',
        '--agent',
        'codex-test',
      ])
      expect(claimed.exitCode).toBe(0)
      expect(claimed.stdout).toContain('Fencing token: 1')
      expect(existsSync(join(root, 'sim-pg-01', '.git'))).toBe(true)
      expect(plan.items[0]).toMatchObject({
        lifecycle: 'active',
        agent: 'codex-test',
        localRepositoryPath: repository,
        execution: { lease: { state: 'active', fencingToken: 1 } },
      })

      const attemptId = /Attempt: (attempt-[^\n]+)/.exec(claimed.stdout)?.[1]
      expect(attemptId).toBeDefined()
      const heartbeat = await runPlanNode(repository, server, [
        'heartbeat',
        '--node',
        'PG-01',
        '--attempt',
        attemptId ?? '',
      ])
      expect(heartbeat.exitCode).toBe(0)

      const racing = await runPlanNode(repository, server, [
        'claim',
        '--node',
        'PG-01',
        '--agent',
        'second-agent',
      ])
      expect(racing.exitCode).toBe(1)
      expect(racing.stderr).toContain('is not ready')

      const bound = await runPlanNode(repository, server, [
        'bind-pr',
        '--node',
        'PG-01',
        '--pr',
        '42',
      ])
      expect(bound.exitCode).toBe(0)
      expect(plan.items[0]?.primaryPr).toMatchObject({ number: 42, state: 'Draft' })
    } finally {
      server.stop(true)
    }
  })
})
