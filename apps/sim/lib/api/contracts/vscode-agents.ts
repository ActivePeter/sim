import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  vscodeCatalogSchema,
  vscodeSelectionSchema,
  vscodeSessionIdentitySchema,
} from '@/lib/vibe-vscode/types'

export type { ProjectSession, VibeVscodeHostContext, VscodeHost } from '@/lib/vibe-vscode/types'

const scope = z.object({ workspaceId: workspaceIdSchema })
const hostSchema = z.object({
  id: z.string(),
  catalog: vscodeCatalogSchema,
  revision: z.number().int(),
  updatedAt: z.string(),
})

export const syncVscodeHostBodySchema = scope.extend({
  catalog: vscodeCatalogSchema,
  expectedRevision: z.number().int().nonnegative(),
})
export type SyncVscodeHostBody = z.input<typeof syncVscodeHostBodySchema>

export const listVscodeHostsContract = defineRouteContract({
  method: 'GET',
  path: '/api/vscode/hosts',
  query: scope,
  response: { mode: 'json', schema: z.object({ hosts: z.array(hostSchema) }) },
})
export const syncVscodeHostContract = defineRouteContract({
  method: 'POST',
  path: '/api/vscode/hosts',
  body: syncVscodeHostBodySchema,
  response: { mode: 'json', schema: z.object({ host: hostSchema }) },
})

export const createProjectSessionBodySchema = scope.extend({
  hostId: z.string().min(1).max(512),
  projectUri: z.string().min(1).max(8192),
  logicalWorkspaceId: z.string().min(1).max(512).optional(),
  requestId: z.string().uuid(),
  selection: vscodeSelectionSchema.optional(),
})
export type CreateProjectSessionBody = z.input<typeof createProjectSessionBodySchema>

export const createProjectSessionContract = defineRouteContract({
  method: 'POST',
  path: '/api/vscode/sessions',
  body: createProjectSessionBodySchema,
  response: { mode: 'json', schema: z.object({ id: z.string(), workspaceId: workspaceIdSchema }) },
})
export const listProjectSessionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/vscode/sessions',
  query: scope,
  response: {
    mode: 'json',
    schema: z.object({
      sessions: z.array(
        z.object({
          id: z.string(),
          workspaceId: workspaceIdSchema,
          title: z.string().nullable(),
          updatedAt: z.string(),
          activeStreamId: z.string().nullable(),
          status: z.enum([
            'idle',
            'running',
            'complete',
            'cancelled',
            'error',
            'interrupted',
            'unknown',
          ]),
          origin: vscodeSessionIdentitySchema.nullable(),
          runtime: z.enum(['local-codex', 'sim']),
        })
      ),
    }),
  },
})
export const stopProjectSessionBodySchema = scope.extend({
  chatId: z.string().uuid(),
  streamId: z.string().min(1).max(512),
})
export const stopProjectSessionContract = defineRouteContract({
  method: 'POST',
  path: '/api/vscode/sessions/stop',
  body: stopProjectSessionBodySchema,
  response: { mode: 'json', schema: z.object({ stopped: z.boolean() }) },
})
export type StopProjectSessionBody = z.input<typeof stopProjectSessionBodySchema>

/** Streaming is the native chat protocol; unsupported cloud-only inputs fail explicitly. */
export const localProjectChatBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    chatId: z.string().uuid(),
    userMessageId: z.string().uuid(),
    message: z.string().trim().min(1).max(128_000),
    fileAttachments: z.array(z.unknown()).max(0).optional(),
    resourceAttachments: z.array(z.unknown()).max(0).optional(),
    contexts: z.array(z.unknown()).max(0).optional(),
  })
  .passthrough()
export type LocalProjectChatBody = z.output<typeof localProjectChatBodySchema>
