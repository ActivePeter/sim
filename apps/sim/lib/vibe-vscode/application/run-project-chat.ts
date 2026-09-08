import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { vscodeAgentOperations } from '@/lib/vibe-vscode/application/operations'
import { resolveChatContext } from '@/lib/vibe-vscode/application/projects'
import { resolveLocalProject } from '@/lib/vibe-vscode/local-codex'
import { type StartProjectChatInput, startProjectChat } from '@/lib/vibe-vscode/project-chat'
import { vscodeSessionOriginSchema } from '@/lib/vibe-vscode/types'

export const runProjectChat = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.runSession,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: { userId: string }
    input: StartProjectChatInput
  }) => resolveChatContext(principal.userId, input),
  authorizationOptions: {},
  execute: async ({ principal, context, input }) => {
    if (!context.binding) throw new OrchestrationError('not_found', 'Project session not found')
    const cwd = await resolveLocalProject(vscodeSessionOriginSchema.parse(context.binding.origin))
    return startProjectChat(principal.userId, input, cwd)
  },
})
