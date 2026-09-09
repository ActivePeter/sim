import {
  getProjectAgentConfigContract,
  updateProjectAgentConfigContract,
} from '@/lib/api/contracts/vscode-agents'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import {
  getProjectAgentConfig,
  updateProjectAgentConfig,
} from '@/lib/vibe-vscode/application/agent-config'
import { vscodeAgentOperations } from '@/lib/vibe-vscode/application/operations'
import { vscodeGatewaySessionAuth } from '@/lib/vibe-vscode/gateway'

export const GET = defineInternalJsonRoute({
  contract: getProjectAgentConfigContract,
  auth: vscodeGatewaySessionAuth,
  operation: vscodeAgentOperations.readConfig,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated, bounded per-chat configuration read',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, query }) => ({ ...params, ...query }),
  useCase: getProjectAgentConfig,
  present: (result) => result,
})

export const PATCH = defineInternalJsonRoute({
  contract: updateProjectAgentConfigContract,
  auth: vscodeGatewaySessionAuth,
  operation: vscodeAgentOperations.updateConfig,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated, revision-checked native session configuration update',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ params, body }) => ({ ...params, ...body }),
  useCase: updateProjectAgentConfig,
  present: (result) => result,
})
