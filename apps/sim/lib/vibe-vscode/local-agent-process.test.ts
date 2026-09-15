/** @vitest-environment node */
import { tmpdir } from 'node:os'
import { toRecordOrNull } from '@sim/utils/object'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type LocalAgentEvent,
  queryLocalAgentProcess,
  runLocalAgentProcess,
} from '@/lib/vibe-vscode/local-agent-process'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

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
  it('does not leave a cleanup timer after a normally completed turn', async () => {
    vi.useFakeTimers()
    await runLocalAgentProcess({
      executable: process.execPath,
      label: 'Test',
      cwd: tmpdir(),
      environment: {},
      args: ['-e', 'process.stdin.resume();'],
      prompt: '',
      signal: new AbortController().signal,
      parseLine: () => [],
      onEvent: vi.fn(),
    })
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('bounded local Agent model query lifecycle', () => {
  it('uses stdio request/response without sending prompts, project context, or application secrets', async () => {
    vi.stubEnv('DATABASE_URL', 'synthetic-private-dsn')
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-app-key')
    const result = await queryLocalAgentProcess({
      executable: process.execPath,
      label: 'Test',
      environment: { CODEX_HOME: '/synthetic/runner-home' },
      args: [
        '-e',
        `
        const lines = require('node:readline').createInterface({ input: process.stdin });
        lines.on('line', line => {
          const message = JSON.parse(line);
          process.stderr.write('private-runner-diagnostics');
          process.stdout.write(JSON.stringify({ id: message.id, result: {
            hasSecrets: Boolean(process.env.DATABASE_URL || process.env.ANTHROPIC_API_KEY),
            cwd: process.cwd(), home: process.env.CODEX_HOME, literal: message.literal, pid: process.pid,
          } }) + '\\n');
        });
      `,
      ],
      initialMessage: { id: 0 },
      onMessage(message, send) {
        const response = toRecordOrNull(message)
        if (response?.id === 0) {
          send({ id: 1, literal: '$(not-a-command)' })
          return
        }
        return toRecordOrNull(response?.result) ?? undefined
      },
    })
    expect(result).toEqual({
      hasSecrets: false,
      cwd: tmpdir(),
      home: '/synthetic/runner-home',
      literal: '$(not-a-command)',
      pid: expect.any(Number),
    })
    expect(() => process.kill(Number(result.pid), 0)).toThrow()
  })
  it('times out an unresponsive protocol and reaps the process before rejecting', async () => {
    vi.useFakeTimers()
    let ready!: () => void
    let pid = 0
    const started = new Promise<void>((resolve) => {
      ready = resolve
    })
    const pending = queryLocalAgentProcess({
      executable: process.execPath,
      label: 'Test',
      environment: {},
      args: [
        '-e',
        `process.stdout.write(JSON.stringify({ pid: process.pid }) + '\\n'); process.stdin.resume();`,
      ],
      initialMessage: { id: 0 },
      onMessage(message) {
        pid = Number(toRecordOrNull(message)?.pid)
        ready()
        return undefined
      },
    })
    const rejected = expect(pending).rejects.toThrow('timed out')
    await started
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('escalates cleanup when a completed query process ignores termination', async () => {
    vi.useFakeTimers()
    let ready!: () => void
    let pid = 0
    const started = new Promise<void>((resolve) => {
      ready = resolve
    })
    const pending = queryLocalAgentProcess({
      executable: process.execPath,
      label: 'Test',
      environment: {},
      args: [
        '-e',
        `process.on('SIGTERM', () => {}); process.stdout.write(JSON.stringify({ pid: process.pid }) + '\\n'); setInterval(() => {}, 1000);`,
      ],
      initialMessage: { id: 0 },
      onMessage(message) {
        pid = Number(toRecordOrNull(message)?.pid)
        ready()
        return 'catalog'
      },
    })
    await started
    await vi.advanceTimersByTimeAsync(3000)
    expect(await pending).toBe('catalog')
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it.each([
    [`process.stdout.write('x'.repeat(2_000_001)); process.stdin.resume();`, 'size limit'],
    [`process.stderr.write('private-secret'); process.exit(1);`, 'before returning a catalog'],
    [
      `process.stdout.write('private malformed response\\n'); process.stdin.resume();`,
      'invalid or unsupported',
    ],
  ])(
    'rejects incomplete or oversized discovery without exposing raw output',
    async (script, error) => {
      await expect(
        queryLocalAgentProcess({
          executable: process.execPath,
          label: 'Test',
          environment: {},
          args: ['-e', script],
          initialMessage: { id: 0 },
          onMessage: () => undefined,
        })
      ).rejects.toThrow(error)
    }
  )
})
