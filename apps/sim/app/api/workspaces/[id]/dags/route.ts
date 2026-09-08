import { createDagContract, listDagsContract } from '@/lib/api/contracts/dags'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalDagErrorPolicy } from '@/lib/dags/api'
import { createDag, listDags } from '@/lib/dags/application/dags'
import { dagOperations } from '@/lib/dags/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listDagsContract,
  auth: internalSessionAuth,
  operation: dagOperations.list,
  rateLimit: internalRateLimits.none({
    reason: 'Workspace DAG operations share the internal session policy',
  }),
  errorPolicy: internalDagErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id }),
  useCase: listDags,
})
export const POST = defineInternalJsonRoute({
  contract: createDagContract,
  auth: internalSessionAuth,
  operation: dagOperations.create,
  rateLimit: internalRateLimits.none({
    reason: 'Workspace DAG operations share the internal session policy',
  }),
  errorPolicy: internalDagErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, ...body }),
  useCase: createDag,
})
