import { z } from 'zod'
import { workspaceFileIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { dagDocumentSchema, dagIdSchema } from '@/lib/dags/model'

export const dagWorkspaceParamsSchema = z.object({ id: workspaceIdSchema })
export const dagParamsSchema = dagWorkspaceParamsSchema.extend({ dagId: dagIdSchema })
export const dagSummarySchema = z.object({
  id: dagIdSchema,
  name: z.string().min(1).max(200),
  repository: z.string(),
  revision: z.number().int().nonnegative(),
})
export type DagSummary = z.output<typeof dagSummarySchema>
export const dagResponseSchema = z.object({ dag: dagDocumentSchema })
export type DagResponse = z.output<typeof dagResponseSchema>
export const dagListResponseSchema = z.object({ dags: z.array(dagSummarySchema).max(1_000) })
export type DagListResponse = z.output<typeof dagListResponseSchema>

export const createDagBodySchema = z
  .object({
    name: z.string().trim().min(1, 'DAG name is required').max(200),
    repository: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/, 'Repository must be owner/name')
      .max(300),
    remote: z.string().trim().min(1).max(200),
    defaultBranch: z.string().trim().min(1).max(200),
  })
  .strict()
export type CreateDagBody = z.input<typeof createDagBodySchema>
export const updateDagBodySchema = z
  .object({
    document: dagDocumentSchema,
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict()
export type UpdateDagBody = z.input<typeof updateDagBodySchema>
export const importLegacyDagBodySchema = z.object({ fileId: workspaceFileIdSchema }).strict()
export type ImportLegacyDagBody = z.input<typeof importLegacyDagBodySchema>

export const listDagsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/dags',
  params: dagWorkspaceParamsSchema,
  response: { mode: 'json', schema: dagListResponseSchema },
})
export const createDagContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/dags',
  params: dagWorkspaceParamsSchema,
  body: createDagBodySchema,
  response: { mode: 'json', schema: dagResponseSchema, status: 201 },
})
export const readDagContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/dags/[dagId]',
  params: dagParamsSchema,
  response: { mode: 'json', schema: dagResponseSchema },
})
export const updateDagContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/dags/[dagId]',
  params: dagParamsSchema,
  body: updateDagBodySchema,
  response: { mode: 'json', schema: dagResponseSchema },
})
export const importLegacyDagContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/dag-imports',
  params: dagWorkspaceParamsSchema,
  body: importLegacyDagBodySchema,
  response: { mode: 'json', schema: dagResponseSchema },
})
