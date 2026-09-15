import { stopProjectSessionContract } from '@/lib/api/contracts/vscode-agents'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { vscodeAgentOperations } from '@/lib/vibe-vscode/application/operations'
import { stopProjectSession } from '@/lib/vibe-vscode/application/projects'
import { vscodeGatewaySessionAuth } from '@/lib/vibe-vscode/gateway'

export const POST = defineInternalJsonRoute({
  contract: stopProjectSessionContract,
  auth: vscodeGatewaySessionAuth,
  operation: vscodeAgentOperations.stopSession,
  rateLimit: internalRateLimits.none({
    reason: 'An authenticated owner must always be able to stop the observed turn',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: stopProjectSession,
  present: (result) => result,
})
