import { listVscodeHostsContract, syncVscodeHostContract } from '@/lib/api/contracts/vscode-agents'
import {
  defineInternalJsonRoute,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { vscodeAgentOperations } from '@/lib/vibe-vscode/application/operations'
import { listVscodeHosts, syncVscodeHost } from '@/lib/vibe-vscode/application/projects'
import { vscodeGatewaySessionAuth } from '@/lib/vibe-vscode/gateway'

export const GET = defineInternalJsonRoute({
  contract: listVscodeHostsContract,
  auth: vscodeGatewaySessionAuth,
  operation: vscodeAgentOperations.listHosts,
  rateLimit: internalRateLimits.none({
    reason: 'Authenticated, bounded workspace projection query',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ query }) => query,
  useCase: listVscodeHosts,
  present: (result) => result,
})
export const POST = defineInternalJsonRoute({
  contract: syncVscodeHostContract,
  auth: vscodeGatewaySessionAuth,
  operation: vscodeAgentOperations.syncHost,
  rateLimit: internalRateLimits.none({
    reason: 'Same-origin authenticated catalog projection with revision CAS',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => body,
  useCase: syncVscodeHost,
  present: (result) => result,
})
