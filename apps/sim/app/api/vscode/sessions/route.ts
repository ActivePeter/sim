import {
  createProjectSessionContract,
  listProjectSessionsContract,
} from '@/lib/api/contracts/vscode-agents'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { vscodeAgentOperations } from '@/lib/vibe-vscode/application/operations'
import { createProjectSession, listProjectSessions } from '@/lib/vibe-vscode/application/projects'
import { vscodeGatewaySessionAuth } from '@/lib/vibe-vscode/gateway'

export const GET = defineInternalJsonRoute({
  contract: listProjectSessionsContract,
  auth: vscodeGatewaySessionAuth,
  operation: vscodeAgentOperations.listSessions,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated monitor poll with a bounded result set',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listProjectSessions,
  present: (result) => result,
})
export const POST = defineInternalJsonRoute({
  contract: createProjectSessionContract,
  auth: vscodeGatewaySessionAuth,
  operation: vscodeAgentOperations.createSession,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated, idempotent empty native session creation',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: createProjectSession,
  present: (result) => result,
})
