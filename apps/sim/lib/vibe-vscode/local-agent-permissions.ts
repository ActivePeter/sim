import { env } from '@/lib/core/config/env'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getProjectAgentPermission,
  type ProjectAgentId,
  type ProjectAgentPermissionMode,
  type ProjectAgentPermissionPolicy,
} from '@/lib/vibe-vscode/agent-config'

/** The same deployment ceiling supplies UI choices and validates saved and executed permissions. */
export function getLocalAgentPermissionPolicy(
  agentId: ProjectAgentId
): ProjectAgentPermissionPolicy {
  const allowUnrestricted = env.SIM_VSCODE_ALLOW_UNRESTRICTED === 'true'
  const unrestrictedModes: ProjectAgentPermissionPolicy['modes'] = allowUnrestricted
    ? [
        {
          id: 'danger-full-access',
          label: '不限制',
          description: '关闭执行沙箱和逐项审批，可读写服务账号有权限访问的项目外文件并执行命令。',
        },
      ]
    : []
  if (agentId === 'local-claude') {
    return {
      defaultMode: 'read-only',
      description: allowUnrestricted
        ? 'Claude Code 默认仅使用只读工具；可显式选择不限制以启用本地读写和命令执行。'
        : '当前 Claude Code 接入仅开放 Read / Grep / Glob，不执行 shell 或修改文件。',
      modes: [
        {
          id: 'read-only',
          label: '只读',
          description: '只使用 Read / Grep / Glob；禁用写入、shell、MCP 和 hooks。',
        },
        ...unrestrictedModes,
      ],
    }
  }
  const defaultMode = env.SIM_VSCODE_CODEX_SANDBOX ?? 'read-only'
  /** Environment validation may be disabled; an opt-in must never make unrestricted the default. */
  if (defaultMode !== 'read-only' && defaultMode !== 'workspace-write') {
    throw new OrchestrationError('forbidden', '部署默认权限配置无效，请联系管理员。')
  }
  return {
    defaultMode,
    description: allowUnrestricted
      ? '不限制须按会话显式选择；部署默认保留原有沙箱权限。'
      : defaultMode === 'workspace-write'
        ? '部署最高允许项目内读写，沙箱外操作不自动批准。'
        : '当前部署仅开放只读；项目写入需要部署管理员授权。',
    modes: [
      {
        id: 'read-only',
        label: '只读',
        description: '允许读取文件和执行沙箱内只读命令，禁止写入。',
      },
      ...(defaultMode === 'workspace-write' || allowUnrestricted
        ? [
            {
              id: 'workspace-write' as const,
              label: '项目内读写',
              description: '允许修改当前项目并执行沙箱内命令，不批准沙箱外权限。',
            },
          ]
        : []),
      ...unrestrictedModes,
    ],
  }
}

export function resolveLocalAgentPermission(
  agentId: ProjectAgentId,
  mode: ProjectAgentPermissionMode | null | undefined
): ProjectAgentPermissionMode {
  const permission = getProjectAgentPermission(getLocalAgentPermissionPolicy(agentId), mode)
  if (!permission) {
    throw new OrchestrationError(
      'forbidden',
      '当前 Agent 或部署策略不允许所选执行权限，请重新选择。'
    )
  }
  return permission.id
}
