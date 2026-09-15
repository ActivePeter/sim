import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getProjectAgentModel,
  type ProjectAgentCapability,
  type ProjectAgentId,
  type ProjectAgentSettings,
  projectAgentSettingsSchema,
} from '@/lib/vibe-vscode/agent-config'
import { localAgentModelCatalogs } from '@/lib/vibe-vscode/local-agent-models'
import {
  getLocalAgentPermissionPolicy,
  resolveLocalAgentPermission,
} from '@/lib/vibe-vscode/local-agent-permissions'
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

async function getProjectAgentAvailability(
  id: ProjectAgentId
): Promise<Omit<ProjectAgentCapability, 'modelCatalog'>> {
  if (id === 'local-codex') {
    const available = await executableAvailable(env.SIM_VSCODE_CODEX_BINARY ?? 'codex')
    return {
      id,
      label: 'Codex',
      available,
      ...(!available ? { unavailableReason: '服务端未安装或未配置 Codex 运行器' } : {}),
      permissions: getLocalAgentPermissionPolicy(id),
    }
  }
  const available = await executableAvailable(env.SIM_VSCODE_CLAUDE_BINARY ?? 'claude')
  return {
    id,
    label: 'Claude Code',
    available,
    ...(!available ? { unavailableReason: '服务端未安装或未配置 Claude Code 运行器' } : {}),
    permissions: getLocalAgentPermissionPolicy(id),
  }
}

/** Runtime capabilities are server-owned; the UI never invents Agents or model catalogs. */
export async function getProjectAgentCapabilities(): Promise<ProjectAgentCapability[]> {
  return Promise.all(
    (['local-codex', 'local-claude'] as const).map(async (id) => {
      const agent = await getProjectAgentAvailability(id)
      return {
        ...agent,
        modelCatalog: agent.available
          ? await localAgentModelCatalogs.read(id)
          : { status: 'error' as const, message: agent.unavailableReason! },
      }
    })
  )
}

async function checkProjectAgentSettings(input: ProjectAgentSettings) {
  const parsed = projectAgentSettingsSchema.safeParse(input)
  if (!parsed.success) {
    throw new OrchestrationError('validation', 'Invalid project Agent configuration')
  }
  const settings = parsed.data
  const permissionMode = resolveLocalAgentPermission(settings.agentId, settings.permissionMode)
  const capability = await getProjectAgentAvailability(settings.agentId)
  if (!capability.available) {
    throw new OrchestrationError(
      'validation',
      capability.unavailableReason ?? 'Project Agent is unavailable'
    )
  }
  if (settings.model === null) {
    if (settings.reasoningEffort !== null) {
      throw new OrchestrationError(
        'validation',
        '请先选择模型再设置推理强度，运行器默认项同时继承模型和推理配置。'
      )
    }
    return { settings: Object.freeze(settings), model: undefined, permissionMode }
  }
  const catalog = await localAgentModelCatalogs.read(settings.agentId)
  if (catalog.status === 'error') throw new OrchestrationError('validation', catalog.message)
  const model = getProjectAgentModel(catalog, settings.model)
  if (!model) {
    throw new OrchestrationError('validation', '当前模型不在运行器目录中，请刷新并重新选择模型。')
  }
  if (settings.reasoningEffort && !model.reasoningEfforts.includes(settings.reasoningEffort)) {
    throw new OrchestrationError('validation', '当前模型不支持所选推理强度，请重新选择。')
  }
  return { settings: Object.freeze(settings), model, permissionMode }
}

export async function validateProjectAgentSettings(
  input: ProjectAgentSettings
): Promise<Readonly<ProjectAgentSettings>> {
  return (await checkProjectAgentSettings(input)).settings
}

export async function runProjectAgent(
  options: LocalAgentTurn & { settings: ProjectAgentSettings }
): Promise<void> {
  if (options.signal.aborted) throw new Error('Agent turn cancelled')
  const { agentId, model, reasoningEffort, instructions, permissionMode } = options.settings
  const checked = await checkProjectAgentSettings({
    agentId,
    model,
    reasoningEffort,
    instructions,
    permissionMode,
  })
  if (options.signal.aborted) throw new Error('Agent turn cancelled')
  /** A concrete model's default must not inherit another model's configured effort. */
  const settings = Object.freeze({
    ...checked.settings,
    permissionMode: checked.permissionMode,
    reasoningEffort:
      checked.settings.reasoningEffort ?? checked.model?.defaultReasoningEffort ?? null,
  })
  const turn = { ...options, settings }
  if (settings.agentId === 'local-codex') await runLocalCodex(turn)
  else await runLocalClaude(turn)
}
