import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ProjectAgentCapability,
  type ProjectAgentSettings,
  projectAgentSettingsSchema,
} from '@/lib/vibe-vscode/agent-config'
import type { LocalAgentTurn } from '@/lib/vibe-vscode/local-agent-process'
import { runLocalClaude } from '@/lib/vibe-vscode/local-claude'
import { runLocalCodex } from '@/lib/vibe-vscode/local-codex'

/** Probe installed binaries without launching a process, reading credentials, or trusting client flags. */
async function executableAvailable(binary: string): Promise<boolean> {
  const candidates = isAbsolute(binary)
    ? [binary]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter((path) => isAbsolute(path))
        .map((path) => join(path, binary))
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await access(candidate, constants.X_OK)
        return (await stat(candidate)).isFile()
      } catch {
        return false
      }
    })
  )
  return results.some(Boolean)
}

/** Runtime capabilities are server-owned; the UI never invents Agents or model catalogs. */
export async function getProjectAgentCapabilities(): Promise<ProjectAgentCapability[]> {
  const [codex, claude] = await Promise.all([
    executableAvailable(env.SIM_VSCODE_CODEX_BINARY ?? 'codex'),
    executableAvailable(env.SIM_VSCODE_CLAUDE_BINARY ?? 'claude'),
  ])
  return [
    {
      id: 'local-codex',
      label: 'Codex',
      available: codex,
      ...(!codex ? { unavailableReason: '服务端未安装或未配置 Codex 运行器' } : {}),
      permissionLabel:
        env.SIM_VSCODE_CODEX_SANDBOX === 'workspace-write'
          ? '项目内写入 · 部署策略'
          : '只读 · 部署策略',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
    {
      id: 'local-claude',
      label: 'Claude Code',
      available: claude,
      ...(!claude ? { unavailableReason: '服务端未安装或未配置 Claude Code 运行器' } : {}),
      permissionLabel: '只读 · Read / Grep / Glob，不执行 shell',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    },
  ]
}

export async function validateProjectAgentSettings(
  input: ProjectAgentSettings
): Promise<Readonly<ProjectAgentSettings>> {
  const parsed = projectAgentSettingsSchema.safeParse(input)
  if (!parsed.success) {
    throw new OrchestrationError('validation', 'Invalid project Agent configuration')
  }
  const settings = parsed.data
  const capability = (await getProjectAgentCapabilities()).find(
    (agent) => agent.id === settings.agentId
  )
  if (!capability?.available) {
    throw new OrchestrationError(
      'validation',
      capability?.unavailableReason ?? 'Project Agent is unavailable'
    )
  }
  if (settings.reasoningEffort && !capability.reasoningEfforts.includes(settings.reasoningEffort)) {
    throw new OrchestrationError(
      'validation',
      'This Agent does not support the selected reasoning effort'
    )
  }
  return Object.freeze(settings)
}

export async function runProjectAgent(
  options: LocalAgentTurn & { settings: ProjectAgentSettings }
): Promise<void> {
  const { agentId, model, reasoningEffort, instructions } = options.settings
  const settings = await validateProjectAgentSettings({
    agentId,
    model,
    reasoningEffort,
    instructions,
  })
  const turn = { ...options, settings }
  if (settings.agentId === 'local-codex') await runLocalCodex(turn)
  else await runLocalClaude(turn)
}
