/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/core/config/env', () => ({
  env: {
    SIM_VSCODE_CODEX_BINARY: '/synthetic/codex',
    SIM_VSCODE_CODEX_HOME: '/synthetic/codex-home',
    SIM_VSCODE_CLAUDE_BINARY: '/synthetic/claude',
    SIM_VSCODE_CLAUDE_HOME: '/synthetic/claude-home',
  },
}))
vi.mock('@/lib/vibe-vscode/local-agent-process', () => ({
  queryLocalAgentProcess: mocks.query,
  runLocalAgentProcess: vi.fn(),
}))

import type { ProjectAgentModel } from '@/lib/vibe-vscode/agent-config'
import type { queryLocalAgentProcess } from '@/lib/vibe-vscode/local-agent-process'
import { getLocalClaudeModels } from '@/lib/vibe-vscode/local-claude'
import { getLocalCodexModels } from '@/lib/vibe-vscode/local-codex'

type DiscoveryOptions = Parameters<typeof queryLocalAgentProcess<ProjectAgentModel[]>>[0]
const codexModel = (id: string, efforts = ['low', 'high']) => ({
  model: id,
  displayName: `Model ${id}`,
  description: 'Runtime description',
  supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
    reasoningEffort,
    description: '',
  })),
  defaultReasoningEffort: efforts[0] ?? null,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue([])
})

describe('Codex model discovery protocol', () => {
  it('initializes before paginated model/list requests and publishes only model capability metadata', async () => {
    await getLocalCodexModels()
    const options: DiscoveryOptions = mocks.query.mock.calls[0][0]
    expect({
      executable: options.executable,
      args: options.args,
      environment: options.environment,
      initialMessage: options.initialMessage,
    }).toEqual({
      executable: '/synthetic/codex',
      args: ['app-server', '--listen', 'stdio://'],
      environment: { CODEX_HOME: '/synthetic/codex-home' },
      initialMessage: {
        id: 0,
        method: 'initialize',
        params: { clientInfo: { name: 'sim-model-catalog', version: '1.0.0' }, capabilities: null },
      },
    })
    const send = vi.fn()
    expect(options.onMessage({ method: 'notification' }, send)).toBeUndefined()
    expect(options.onMessage({ id: 99, error: {} }, send)).toBeUndefined()
    options.onMessage({ id: 0, result: {} }, send)
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { method: 'initialized' },
      { id: 1, method: 'model/list', params: { limit: 100, includeHidden: false, cursor: null } },
    ])
    expect(
      options.onMessage(
        {
          id: 1,
          result: {
            data: [codexModel('one'), { ...codexModel('hidden'), hidden: true }],
            nextCursor: 'next-page',
          },
        },
        send
      )
    ).toBeUndefined()
    expect(send).toHaveBeenLastCalledWith({
      id: 2,
      method: 'model/list',
      params: { limit: 100, includeHidden: false, cursor: 'next-page' },
    })
    expect(
      options.onMessage(
        {
          id: 2,
          result: {
            data: [codexModel('two', ['high', 'max', 'ultra'])],
            nextCursor: null,
            credentials: 'must-not-be-projected',
          },
        },
        send
      )
    ).toEqual([
      {
        id: 'one',
        label: 'Model one',
        description: 'Runtime description',
        reasoningEfforts: ['low', 'high'],
        defaultReasoningEffort: 'low',
      },
      {
        id: 'two',
        label: 'Model two',
        description: 'Runtime description',
        reasoningEfforts: ['high', 'max', 'ultra'],
        defaultReasoningEffort: 'high',
      },
    ])
  })
  it('rejects non-terminating pagination and duplicate model IDs across pages', async () => {
    await getLocalCodexModels()
    const options: DiscoveryOptions = mocks.query.mock.calls[0][0]
    const send = vi.fn()
    options.onMessage({ id: 0, result: {} }, send)
    options.onMessage({ id: 1, result: { data: [codexModel('one')], nextCursor: 'same' } }, send)
    expect(() =>
      options.onMessage({ id: 2, result: { data: [codexModel('two')], nextCursor: 'same' } }, send)
    ).toThrow('pagination')
    await getLocalCodexModels()
    const next: DiscoveryOptions = mocks.query.mock.calls[1][0]
    next.onMessage({ id: 0, result: {} }, send)
    expect(() =>
      next.onMessage(
        { id: 1, result: { data: [codexModel('one'), codexModel('one')], nextCursor: null } },
        send
      )
    ).toThrow()
  })
  it.each([
    { data: [], nextCursor: null },
    { data: [codexModel('--unsafe')], nextCursor: null },
    { data: [codexModel('one', ['high', 'unsafe"\n-c'])], nextCursor: null },
    { data: [codexModel('one')] },
  ])('rejects malformed or incomplete model catalogs: %j', async (result) => {
    await getLocalCodexModels()
    const options: DiscoveryOptions = mocks.query.mock.calls[0][0]
    options.onMessage({ id: 0, result: {} }, vi.fn())
    expect(() => options.onMessage({ id: 1, result }, vi.fn())).toThrow()
  })
  it('does not project private protocol errors', async () => {
    await getLocalCodexModels()
    const options: DiscoveryOptions = mocks.query.mock.calls[0][0]
    expect(() =>
      options.onMessage({ id: 0, error: { message: 'private-provider-key' } }, vi.fn())
    ).toThrow('Codex model discovery failed')
  })
})

describe('Claude Code model discovery protocol', () => {
  it("only initializes a tool-free non-persistent session and uses each model's effort metadata", async () => {
    await getLocalClaudeModels()
    const options: DiscoveryOptions = mocks.query.mock.calls[0][0]
    expect({
      executable: options.executable,
      environment: options.environment,
      tools: options.args[options.args.indexOf('--tools') + 1],
      input: options.args[options.args.indexOf('--input-format') + 1],
      persistent: !options.args.includes('--no-session-persistence'),
    }).toEqual({
      executable: '/synthetic/claude',
      environment: { CLAUDE_CONFIG_DIR: '/synthetic/claude-home' },
      tools: '',
      input: 'stream-json',
      persistent: false,
    })
    expect(options.args).toContain('--disable-slash-commands')
    expect(options.args).toContain('{"disableAllHooks":true}')
    expect(options.initialMessage).toEqual({
      type: 'control_request',
      request_id: 'sim-model-catalog',
      request: { subtype: 'initialize' },
    })
    const send = vi.fn()
    expect(
      options.onMessage({ type: 'control_response', response: { request_id: 'other' } }, send)
    ).toBeUndefined()
    expect(
      options.onMessage(
        {
          type: 'control_response',
          response: {
            request_id: 'sim-model-catalog',
            subtype: 'success',
            response: {
              account: { email: 'private@example.test' },
              models: [
                {
                  value: 'default',
                  resolvedModel: 'resolved-default',
                  displayName: 'Default alias',
                  description: 'Runner default',
                  supportsEffort: true,
                  supportedEffortLevels: ['low', 'max'],
                },
                { value: 'fast', displayName: 'Fast', description: 'No reasoning levels' },
              ],
            },
          },
        },
        send
      )
    ).toEqual([
      {
        id: 'default',
        aliases: ['resolved-default'],
        label: 'Default alias',
        description: 'Runner default',
        reasoningEfforts: ['low', 'max'],
        defaultReasoningEffort: null,
      },
      {
        id: 'fast',
        label: 'Fast',
        description: 'No reasoning levels',
        reasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ])
    expect(send).not.toHaveBeenCalled()
  })
  it('refuses to invent a level list when an older runner omits required effort metadata', async () => {
    await getLocalClaudeModels()
    const options: DiscoveryOptions = mocks.query.mock.calls[0][0]
    expect(() =>
      options.onMessage(
        {
          type: 'control_response',
          response: {
            request_id: 'sim-model-catalog',
            subtype: 'success',
            response: {
              models: [
                {
                  value: 'reasoning',
                  displayName: 'Reasoning',
                  description: '',
                  supportsEffort: true,
                },
              ],
            },
          },
        },
        vi.fn()
      )
    ).toThrow('per-model effort')
  })
  it('treats a failed initialize as failure rather than an empty catalog', async () => {
    await getLocalClaudeModels()
    const options: DiscoveryOptions = mocks.query.mock.calls[0][0]
    expect(() =>
      options.onMessage(
        {
          type: 'control_response',
          response: {
            request_id: 'sim-model-catalog',
            subtype: 'error',
            error: 'private credentials',
          },
        },
        vi.fn()
      )
    ).toThrow('Claude Code model discovery failed')
  })
})
