import { z } from 'zod'
import { dagSummarySchema, updateDagBodySchema } from '@/lib/api/contracts/dags'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import { dagDocumentSchema, dagIdSchema } from '@/lib/dags/model'

export const v2DagWorkspaceQuerySchema = z.object({ workspaceId: workspaceIdSchema }).strict()
export const v2DagParamsSchema = z.object({ dagId: dagIdSchema })
export const v2UpdateDagBodySchema = updateDagBodySchema.extend({ workspaceId: workspaceIdSchema })
export type V2UpdateDagBody = z.input<typeof v2UpdateDagBodySchema>

export const v2ListDagsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/dags',
  query: v2DagWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(z.array(dagSummarySchema).max(1_000)) },
})
export const v2ReadDagContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/dags/[dagId]',
  params: v2DagParamsSchema,
  query: v2DagWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(dagDocumentSchema) },
})
export const v2UpdateDagContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/dags/[dagId]',
  params: v2DagParamsSchema,
  query: noInputSchema,
  body: v2UpdateDagBodySchema,
  response: { mode: 'json', schema: v2DataResponse(dagDocumentSchema) },
})
