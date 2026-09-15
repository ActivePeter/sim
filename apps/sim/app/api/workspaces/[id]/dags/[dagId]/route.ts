import { readDagContract, updateDagContract } from '@/lib/api/contracts/dags'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalDagErrorPolicy } from '@/lib/dags/api'
import { readDag, updateDag } from '@/lib/dags/application/dags'
import { dagOperations } from '@/lib/dags/application/operations'
import { MAX_DAG_CONTENT_BYTES } from '@/lib/dags/model'

export const GET = defineInternalJsonRoute({
  contract: readDagContract,
  auth: internalSessionAuth,
  operation: dagOperations.read,
  rateLimit: internalRateLimits.none({
    reason: 'Workspace DAG operations share the internal session policy',
  }),
  errorPolicy: internalDagErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, dagId: params.dagId }),
  useCase: readDag,
})
export const PUT = defineInternalJsonRoute({
  contract: updateDagContract,
  auth: internalSessionAuth,
  operation: dagOperations.update,
  rateLimit: internalRateLimits.none({
    reason: 'Workspace DAG operations share the internal session policy',
  }),
  errorPolicy: internalDagErrorPolicy,
  parseOptions: { maxBodyBytes: MAX_DAG_CONTENT_BYTES + 1024 },
  mapInput: ({ params, body }) => ({ workspaceId: params.id, dagId: params.dagId, ...body }),
  useCase: updateDag,
})
