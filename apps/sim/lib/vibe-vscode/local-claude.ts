import { toRecordOrNull } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { env } from '@/lib/core/config/env'
import type { ProjectAgentSettings } from '@/lib/vibe-vscode/agent-config'
import {
  type LocalAgentEvent,
  type LocalAgentTurn,
  runLocalAgentProcess,
} from '@/lib/vibe-vscode/local-agent-process'

/** Claude's non-interactive adapter is read-only; browser settings cannot widen permissions. */
export function localClaudeArguments(settings: ProjectAgentSettings, threadId?: string): string[] {
  const args = [
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
  ]
  if (settings.model) args.push('--model', settings.model)
  if (settings.reasoningEffort) args.push('--effort', settings.reasoningEffort)
  if (threadId) args.push('--resume', threadId)
  return args
}

function textBlocks(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map(toRecordOrNull)
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

/** Normalizes the complete-message Claude Code print protocol, without double-counting results. */
export function createClaudeEventParser(): (line: string) => LocalAgentEvent[] {
  const tools = new Map<string, string>()
  let sawText = false
  return (line) => {
    let raw: Record<string, unknown> | null
    try {
      raw = toRecordOrNull(JSON.parse(line))
    } catch {
      return []
    }
    if (!raw || raw.parent_tool_use_id) return []
    if (raw.type === 'system' && raw.subtype === 'init' && typeof raw.session_id === 'string') {
      return [{ type: 'thread_started', threadId: raw.session_id }]
    }
    const events: LocalAgentEvent[] = []
    if (raw.type === 'assistant' || raw.type === 'user') {
      const message = toRecordOrNull(raw.message)
      if (!Array.isArray(message?.content)) return []
      for (const item of message.content) {
        const block = toRecordOrNull(item)
        if (!block) continue
        if (raw.type === 'assistant' && block.type === 'text' && typeof block.text === 'string') {
          sawText = true
          events.push({ type: 'text', text: block.text })
        } else if (
          raw.type === 'assistant' &&
          block.type === 'thinking' &&
          typeof block.thinking === 'string'
        ) {
          events.push({ type: 'thinking', text: block.thinking })
        } else if (
          raw.type === 'assistant' &&
          block.type === 'tool_use' &&
          typeof block.id === 'string' &&
          typeof block.name === 'string'
        ) {
          tools.set(block.id, block.name)
          events.push({
            type: 'tool_start',
            id: block.id,
            toolName: block.name,
            summary: truncate(JSON.stringify(block.input ?? {}), 500),
          })
        } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          events.push({
            type: 'tool_end',
            id: block.tool_use_id,
            toolName: tools.get(block.tool_use_id) ?? 'tool',
            isError: block.is_error === true,
            output: truncate(textBlocks(block.content), 4000),
          })
          tools.delete(block.tool_use_id)
        }
      }
    } else if (raw.type === 'result') {
      if (raw.is_error || raw.subtype !== 'success') {
        return [
          {
            type: 'error',
            message:
              'Claude Code could not complete the turn. Check its authentication, model and read-only tool permissions.',
          },
        ]
      }
      if (!sawText && typeof raw.result === 'string' && raw.result)
        events.push({ type: 'text', text: raw.result })
      const usage = toRecordOrNull(raw.usage)
      const count = (key: string) =>
        typeof usage?.[key] === 'number' && Number.isSafeInteger(usage[key]) && usage[key] >= 0
          ? usage[key]
          : 0
      events.push(
        {
          type: 'usage',
          inputTokens: count('input_tokens'),
          outputTokens: count('output_tokens'),
          cachedInputTokens: count('cache_read_input_tokens'),
          cacheWriteInputTokens: count('cache_creation_input_tokens'),
          reasoningOutputTokens: 0,
        },
        { type: 'final' }
      )
    }
    return events
  }
}

export async function runLocalClaude(options: LocalAgentTurn & { settings: ProjectAgentSettings }) {
  await runLocalAgentProcess({
    ...options,
    executable: env.SIM_VSCODE_CLAUDE_BINARY ?? 'claude',
    label: 'Claude Code',
    args: localClaudeArguments(options.settings, options.threadId),
    environment: { CLAUDE_CONFIG_DIR: env.SIM_VSCODE_CLAUDE_HOME ?? process.env.CLAUDE_CONFIG_DIR },
    parseLine: createClaudeEventParser(),
  })
}
