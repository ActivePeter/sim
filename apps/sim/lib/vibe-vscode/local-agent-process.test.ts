/** @vitest-environment node */
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type LocalAgentEvent, runLocalAgentProcess } from '@/lib/vibe-vscode/local-agent-process'

afterEach(() => vi.unstubAllEnvs())

describe('local Agent process lifecycle', () => {
  it('does not inherit application secrets and keeps diagnostics out of the transcript', async () => {
    vi.stubEnv('DATABASE_URL', 'synthetic-private-dsn')
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-app-key')
    vi.stubEnv('VIBE_VSCODE_AGENT_GATEWAY_SECRET', 'synthetic-gateway-key')
    const events: LocalAgentEvent[] = []
    await runLocalAgentProcess({
      executable: process.execPath,
      label: 'Test',
      cwd: tmpdir(),
      prompt: 'literal $(not-a-command)',
      signal: new AbortController().signal,
      environment: { CODEX_HOME: '/synthetic/runner-home' },
      args: [
        '-e',
        `let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x => input += x); process.stdin.on('end', () => { process.stderr.write('private diagnostics'); process.stdout.write(JSON.stringify({ type: 'text', text: JSON.stringify({ hasSecrets: Boolean(process.env.DATABASE_URL || process.env.ANTHROPIC_API_KEY || process.env.VIBE_VSCODE_AGENT_GATEWAY_SECRET), home: process.env.CODEX_HOME, input }) }) + '\\n'); });`,
      ],
      parseLine: (line) => [JSON.parse(line) as LocalAgentEvent],
      onEvent: async (event) => {
        events.push(event)
      },
    })
    expect(events).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          hasSecrets: false,
          home: '/synthetic/runner-home',
          input: 'literal $(not-a-command)',
        }),
      },
    ])
    expect(JSON.stringify(events)).not.toContain('private diagnostics')
  })
  it('stops and reaps the owned process group on cancellation', async () => {
    const controller = new AbortController()
    const onEvent = vi.fn(async () => {
      controller.abort()
    })
    await expect(
      runLocalAgentProcess({
        executable: process.execPath,
        label: 'Test',
        cwd: tmpdir(),
        prompt: '',
        signal: controller.signal,
        environment: {},
        args: [
          '-e',
          `process.stdout.write('{"type":"text","text":"ready"}\\n'); setInterval(() => {}, 1000);`,
        ],
        parseLine: (line) => [JSON.parse(line) as LocalAgentEvent],
        onEvent,
      })
    ).rejects.toThrow('cancelled')
    expect(onEvent).toHaveBeenCalledOnce()
  })
  it('reports an unavailable executable safely and handles an already-cancelled turn', async () => {
    const options = {
      executable: '/synthetic/missing-agent',
      label: 'Test',
      cwd: tmpdir(),
      prompt: '',
      signal: new AbortController().signal,
      environment: {},
      args: [],
      parseLine: () => [],
      onEvent: vi.fn(),
    }
    await expect(runLocalAgentProcess(options)).rejects.toThrow('runner could not start')
    await expect(runLocalAgentProcess({ ...options, signal: AbortSignal.abort() })).rejects.toThrow(
      'cancelled'
    )
  })
})
