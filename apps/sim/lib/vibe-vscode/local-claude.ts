import { toRecordOrNull } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import {
  DEFAULT_PROJECT_AGENT_CONFIG,
  type ProjectAgentModel,
  type ProjectAgentSettings,
  projectAgentEffortSchema,
  projectAgentModelIdSchema,
  projectAgentModelsSchema,
} from '@/lib/vibe-vscode/agent-config'
import { resolveLocalAgentPermission } from '@/lib/vibe-vscode/local-agent-permissions'
import {
  type LocalAgentEvent,
  type LocalAgentTurn,
  queryLocalAgentProcess,
  runLocalAgentProcess,
} from '@/lib/vibe-vscode/local-agent-process'

/** Claude's non-interactive adapter is read-only; browser settings cannot widen permissions. */
export function localClaudeArguments(
  settings: ProjectAgentSettings,
  threadId?: string,
  mode: 'turn' | 'catalog' = 'turn'
): string[] {
  resolveLocalAgentPermission('local-claude', settings.permissionMode)
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'dontAsk',
    '--tools',
    mode === 'catalog' ? '' : 'Read,Grep,Glob',
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
  if (mode === 'catalog') args.push('--input-format', 'stream-json', '--no-session-persistence')
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

function localClaudeProcessOptions() {
  return {
    executable: env.SIM_VSCODE_CLAUDE_BINARY ?? 'claude',
    label: 'Claude Code',
    environment: { CLAUDE_CONFIG_DIR: env.SIM_VSCODE_CLAUDE_HOME ?? process.env.CLAUDE_CONFIG_DIR },
  }
}

const claudeModelListSchema = z.object({
  models: z
    .array(
      z.object({
        value: projectAgentModelIdSchema,
        resolvedModel: projectAgentModelIdSchema.optional(),
        displayName: z.string().min(1).max(200),
        description: z.string().max(2000),
        supportsEffort: z.boolean().optional(),
        supportedEffortLevels: z.array(projectAgentEffortSchema).max(32).optional(),
      })
    )
    .min(1)
    .max(256),
})

/** The print protocol's initialize response supplies models and per-model effort support. */
export async function getLocalClaudeModels(): Promise<ProjectAgentModel[]> {
  const requestId = 'sim-model-catalog'
  return queryLocalAgentProcess({
    ...localClaudeProcessOptions(),
    args: localClaudeArguments(DEFAULT_PROJECT_AGENT_CONFIG, undefined, 'catalog'),
    initialMessage: {
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'initialize' },
    },
    onMessage(message) {
      const envelope = toRecordOrNull(message)
      const response = toRecordOrNull(envelope?.response)
      if (envelope?.type !== 'control_response' || response?.request_id !== requestId) return
      if (response.subtype !== 'success') throw new Error('Claude Code model discovery failed')
      const { models } = claudeModelListSchema.parse(response.response)
      return projectAgentModelsSchema.parse(
        models.map((model) => {
          if (model.supportsEffort && !model.supportedEffortLevels?.length) {
            throw new Error('Claude Code did not provide per-model effort levels')
          }
          return {
            id: model.value,
            ...(model.resolvedModel && model.resolvedModel !== model.value
              ? { aliases: [model.resolvedModel] }
              : {}),
            label: model.displayName,
            description: model.description,
            reasoningEfforts: model.supportsEffort ? model.supportedEffortLevels : [],
            defaultReasoningEffort: null,
          }
        })
      )
    },
  })
}

export async function runLocalClaude(options: LocalAgentTurn & { settings: ProjectAgentSettings }) {
  await runLocalAgentProcess({
    ...options,
    ...localClaudeProcessOptions(),
    args: localClaudeArguments(options.settings, options.threadId),
    parseLine: createClaudeEventParser(),
  })
}
