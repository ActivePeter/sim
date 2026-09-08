import { importLegacyDagContract } from '@/lib/api/contracts/dags'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalDagErrorPolicy } from '@/lib/dags/api'
import { importLegacyDag } from '@/lib/dags/application/dags'
import { dagOperations } from '@/lib/dags/application/operations'

export const POST = defineInternalJsonRoute({
  contract: importLegacyDagContract,
  auth: internalSessionAuth,
  operation: dagOperations.importLegacy,
  rateLimit: internalRateLimits.none({
    reason: 'Workspace DAG operations share the internal session policy',
  }),
  errorPolicy: internalDagErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: importLegacyDag,
  present: ({ dag }) => ({ dag }),
})
