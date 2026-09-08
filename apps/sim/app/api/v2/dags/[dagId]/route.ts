import { v2ReadDagContract, v2UpdateDagContract } from '@/lib/api/contracts/v2/dags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2DagErrorPolicy } from '@/lib/dags/api'
import { readDag, updateDag } from '@/lib/dags/application/dags'
import { dagOperations } from '@/lib/dags/application/operations'
import { MAX_DAG_CONTENT_BYTES } from '@/lib/dags/model'

export const GET = defineV2JsonRoute({
  contract: v2ReadDagContract,
  auth: v2ApiKeyAuth,
  operation: dagOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2DagErrorPolicy,
  mapInput: ({ params, query }) => ({ workspaceId: query.workspaceId, dagId: params.dagId }),
  useCase: readDag,
  present: ({ dag }) => ({ data: dag }),
})
export const PUT = defineV2JsonRoute({
  contract: v2UpdateDagContract,
  auth: v2ApiKeyAuth,
  operation: dagOperations.update,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2DagErrorPolicy,
  parseOptions: { maxBodyBytes: MAX_DAG_CONTENT_BYTES + 1024 },
  mapInput: ({ params, body }) => ({ dagId: params.dagId, ...body }),
  useCase: updateDag,
  present: ({ dag }) => ({ data: dag }),
})
