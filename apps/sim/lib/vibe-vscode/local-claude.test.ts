/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deployment = vi.hoisted(() => ({
  SIM_VSCODE_ALLOW_UNRESTRICTED: undefined as string | undefined,
}))
vi.mock('@/lib/core/config/env', () => ({ env: deployment }))

import { DEFAULT_PROJECT_AGENT_CONFIG } from '@/lib/vibe-vscode/agent-config'
import { createClaudeEventParser, localClaudeArguments } from '@/lib/vibe-vscode/local-claude'

beforeEach(() => {
  deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = undefined
})

describe('Claude Code native project adapter', () => {
  it('rejects a write permission before constructing a Claude invocation', () => {
    expect(() =>
      localClaudeArguments({
        ...DEFAULT_PROJECT_AGENT_CONFIG,
        agentId: 'local-claude',
        permissionMode: 'workspace-write',
      })
    ).toThrow(expect.objectContaining({ code: 'forbidden' }))
  })
  it('pins non-interactive read-only permissions and resumes only the provided session', () => {
    const args = localClaudeArguments(
      {
        ...DEFAULT_PROJECT_AGENT_CONFIG,
        agentId: 'local-claude',
        model: 'test-model',
        reasoningEffort: 'high',
      },
      'thread-one'
    )
    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'dontAsk',
      '--tools',
      'Read,Grep,Glob',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--setting-sources',
      'user',
      '--settings',
      '{"disableAllHooks":true}',
      '--no-chrome',
      '--model',
      'test-model',
      '--effort',
      'high',
      '--resume',
      'thread-one',
    ])
    expect(args.join(' ')).not.toMatch(/bypassPermissions|dangerously|Bash|Edit|Write|--continue/)
  })
  it.each([undefined, 'stored-thread'])(
    'uses unrestricted tools only for an opted-in, explicit fresh or resumed turn: %s',
    (threadId) => {
      const settings = {
        ...DEFAULT_PROJECT_AGENT_CONFIG,
        agentId: 'local-claude' as const,
        permissionMode: 'danger-full-access' as const,
      }
      expect(() => localClaudeArguments(settings, threadId)).toThrow(
        expect.objectContaining({ code: 'forbidden' })
      )
      deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = 'true'
      expect(localClaudeArguments(settings, threadId)).toEqual([
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'bypassPermissions',
        '--tools',
        'default',
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--setting-sources',
        'user',
        '--settings',
        '{"disableAllHooks":true,"sandbox":{"enabled":false}}',
        '--no-chrome',
        '--allow-dangerously-skip-permissions',
        ...(threadId ? ['--resume', threadId] : []),
      ])
      for (const permissionMode of [null, 'read-only'] as const) {
        const args = localClaudeArguments({ ...settings, permissionMode }, threadId)
        expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
        expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob')
        expect(args).toContain('{"disableAllHooks":true}')
        expect(args.join(' ')).not.toMatch(/bypassPermissions|dangerously|sandbox/)
      }
    }
  )
  it.each([undefined, 'true'])(
    'keeps catalog initialization tool-free regardless of saved permissions and deployment opt-in: %s',
    (optIn) => {
      deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = optIn
      const args = localClaudeArguments(
        { ...DEFAULT_PROJECT_AGENT_CONFIG, permissionMode: 'danger-full-access' },
        undefined,
        'catalog'
      )
      expect({
        permission: args[args.indexOf('--permission-mode') + 1],
        tools: args[args.indexOf('--tools') + 1],
        settings: args[args.indexOf('--settings') + 1],
        tail: args.slice(-3),
      }).toEqual({
        permission: 'dontAsk',
        tools: '',
        settings: '{"disableAllHooks":true}',
        tail: ['--input-format', 'stream-json', '--no-session-persistence'],
      })
      expect(args.join(' ')).not.toMatch(/bypassPermissions|dangerously|sandbox|--resume/)
    }
  )
  it('projects the runtime thread, text, thinking and native tool lifecycle', () => {
    const parse = createClaudeEventParser()
    expect(
      parse(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'thread-one' }))
    ).toEqual([{ type: 'thread_started', threadId: 'thread-one' }])
    expect(
      parse(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Inspecting.' },
              { type: 'thinking', thinking: 'Read the project.' },
              { type: 'tool_use', id: 'tool-one', name: 'Read', input: { file_path: 'README.md' } },
            ],
          },
        })
      )
    ).toEqual([
      { type: 'text', text: 'Inspecting.' },
      { type: 'thinking', text: 'Read the project.' },
      {
        type: 'tool_start',
        id: 'tool-one',
        toolName: 'Read',
        summary: '{"file_path":"README.md"}',
      },
    ])
    expect(
      parse(
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-one',
                content: [{ type: 'text', text: 'Project readme' }],
              },
            ],
          },
        })
      )
    ).toEqual([
      {
        type: 'tool_end',
        id: 'tool-one',
        toolName: 'Read',
        isError: false,
        output: 'Project readme',
      },
    ])
  })
  it('counts final aggregate usage once and never repeats the final text', () => {
    const parse = createClaudeEventParser()
    parse(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done' }], usage: { input_tokens: 99 } },
      })
    )
    const result = parse(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Done',
        usage: {
          input_tokens: 10,
          output_tokens: 8,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 2,
        },
      })
    )
    expect(result).toEqual([
      {
        type: 'usage',
        inputTokens: 10,
        outputTokens: 8,
        cachedInputTokens: 4,
        cacheWriteInputTokens: 2,
        reasoningOutputTokens: 0,
      },
      { type: 'final' },
    ])
  })
  it('preserves a result-only response and rejects failed results without exposing diagnostics', () => {
    const parse = createClaudeEventParser()
    expect(
      parse(JSON.stringify({ type: 'result', subtype: 'success', result: 'Only result' }))[0]
    ).toEqual({ type: 'text', text: 'Only result' })
    const failed = parse(
      JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['private-provider-url-and-key'],
      })
    )
    expect(failed).toEqual([
      { type: 'error', message: expect.stringContaining('Claude Code could not complete') },
    ])
    expect(JSON.stringify(failed)).not.toContain('private-provider')
  })
  it('ignores unrelated, child-agent and malformed records', () => {
    const parse = createClaudeEventParser()
    for (const line of [
      'not-json',
      'null',
      '[]',
      '{"type":"rate_limit_event"}',
      '{"type":"assistant","parent_tool_use_id":"child","message":{"content":[{"type":"text","text":"nested"}]}}',
    ]) {
      expect(parse(line)).toEqual([])
    }
  })
})
