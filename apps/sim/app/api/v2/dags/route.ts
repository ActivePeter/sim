import { v2ListDagsContract } from '@/lib/api/contracts/v2/dags'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2DagErrorPolicy } from '@/lib/dags/api'
import { listDags } from '@/lib/dags/application/dags'
import { dagOperations } from '@/lib/dags/application/operations'

export const GET = defineV2JsonRoute({
  contract: v2ListDagsContract,
  auth: v2ApiKeyAuth,
  operation: dagOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2DagErrorPolicy,
  mapInput: ({ query }) => ({ workspaceId: query.workspaceId }),
  useCase: listDags,
  present: ({ dags }) => ({ data: dags }),
})
