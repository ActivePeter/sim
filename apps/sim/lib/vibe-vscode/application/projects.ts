import { chatPubSub } from '@/lib/copilot/chat-status'
import { abortActiveStream, getPendingChatStreamId } from '@/lib/copilot/request/session'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { vscodeAgentOperations } from '@/lib/vibe-vscode/application/operations'
import * as repository from '@/lib/vibe-vscode/projects-repository'
import { type VscodeCatalog, vscodeSessionOriginSchema } from '@/lib/vibe-vscode/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

interface WorkspaceInput {
  workspaceId: string
}
interface SyncHostInput extends WorkspaceInput {
  catalog: VscodeCatalog
  expectedRevision: number
}
export interface ChatInput {
  chatId: string
  workspaceId?: string
}

export async function resolveChatContext(userId: string, input: ChatInput) {
  const row = await repository.loadOwnedChat(userId, input.chatId)
  if (input.workspaceId && row.chat.workspaceId !== input.workspaceId) {
    throw new OrchestrationError('not_found', 'Session not found')
  }
  const workspace = await resolveActiveWorkspaceApplicationContext(row.chat.workspaceId!)
  return { ...workspace, ...row }
}

export const listVscodeHosts = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.listHosts,
  resolveContext: ({ input }: { input: WorkspaceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, context }) => ({
    hosts: await repository.listHosts(principal.userId, context.workspaceId),
  }),
})
export const syncVscodeHost = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.syncHost,
  resolveContext: ({ input }: { input: SyncHostInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }) => ({
    host: await repository.syncHost(
      principal.userId,
      context.workspaceId,
      input.catalog,
      input.expectedRevision
    ),
  }),
})
export const createProjectSession = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.createSession,
  resolveContext: ({ input }: { input: repository.CreateProjectSessionInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input }) => repository.createProjectSession(principal.userId, input),
  afterSuccess: ({ result }) => {
    chatPubSub?.publishStatusChanged({
      workspaceId: result.workspaceId,
      chatId: result.id,
      type: 'created',
    })
  },
})
export const listProjectSessions = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.listSessions,
  resolveContext: ({ input }: { input: WorkspaceInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, context }) => ({
    sessions: await repository.listProjectSessions(principal.userId, context.workspaceId),
  }),
})
export const resolveProjectChatRuntime = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.resolveRuntime,
  resolveContext: ({ principal, input }: { principal: { userId: string }; input: ChatInput }) =>
    resolveChatContext(principal.userId, input),
  authorizationOptions: {},
  execute: async ({ context }) => ({
    local: context.binding !== null,
    origin: context.binding ? vscodeSessionOriginSchema.parse(context.binding.origin) : undefined,
  }),
})
export const stopProjectSession = defineAuthorizedWorkspaceUseCase({
  operation: vscodeAgentOperations.stopSession,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: { userId: string }
    input: ChatInput & { streamId: string }
  }) => resolveChatContext(principal.userId, input),
  authorizationOptions: {},
  execute: async ({ context, input }) => {
    const streamId = await getPendingChatStreamId(context.chat.id)
    if (!streamId || streamId !== input.streamId) return { stopped: false }
    await abortActiveStream(streamId)
    return { stopped: true }
  },
})
