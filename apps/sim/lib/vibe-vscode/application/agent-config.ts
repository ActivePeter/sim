import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { isProjectAgentLocked, readProjectAgentConfig } from '@/lib/vibe-vscode/agent-config'
import { vscodeAgentOperations } from '@/lib/vibe-vscode/application/operations'
import { type ChatInput, resolveChatContext } from '@/lib/vibe-vscode/application/projects'
import {
  getProjectAgentCapabilities,
  validateProjectAgentSettings,
} from '@/lib/vibe-vscode/local-agents'
import * as repository from '@/lib/vibe-vscode/projects-repository'

export const getProjectAgentConfig = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.readConfig,
  resolveContext: ({ principal, input }: { principal: { userId: string }; input: ChatInput }) =>
    resolveChatContext(principal.userId, input),
  authorizationOptions: {},
  execute: async ({ context }) => {
    if (!context.binding) throw new OrchestrationError('not_found', 'Project session not found')
    return {
      config: readProjectAgentConfig(context.binding.agentConfig),
      agentLocked: isProjectAgentLocked(context.binding),
      agents: await getProjectAgentCapabilities(),
    }
  },
})

export const updateProjectAgentConfig = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.updateConfig,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: { userId: string }
    input: repository.UpdateProjectAgentConfigInput
  }) => resolveChatContext(principal.userId, input),
  authorizationOptions: {},
  execute: async ({ principal, input, context }) => {
    if (!context.binding) throw new OrchestrationError('not_found', 'Project session not found')
    const settings = await validateProjectAgentSettings(input.settings)
    return repository.updateProjectAgentConfig(principal.userId, {
      ...input,
      settings,
      workspaceId: context.workspaceId,
      chatId: context.chat.id,
    })
  },
})
