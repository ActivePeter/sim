import { isDeepStrictEqual } from 'node:util'
import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { generateId } from '@sim/utils/id'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application/authorized-workspace-use-case'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { dagOperations } from '@/lib/dags/application/operations'
import {
  createDagDocument,
  type DagDocument,
  dagDocumentSchema,
  getPlanFileName,
  MAX_DAG_CONTENT_BYTES,
} from '@/lib/dags/model'
import {
  findDagByLegacyFile,
  insertWorkspaceDag,
  listWorkspaceDags,
  readWorkspaceDag,
  updateWorkspaceDag,
} from '@/lib/dags/repository'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { archiveWorkspaceFileVersionInTx } from '@/lib/uploads/contexts/workspace/archive-workspace-file-version'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

interface WorkspaceDagInput {
  workspaceId: string
}
interface ReadDagInput extends WorkspaceDagInput {
  dagId: string
}
interface CreateDagInput extends WorkspaceDagInput {
  name: string
  repository: string
  remote: string
  defaultBranch: string
}
interface UpdateDagInput extends ReadDagInput {
  document: DagDocument
  expectedRevision: number
}
interface ImportLegacyDagInput extends WorkspaceDagInput {
  fileId: string
}

function validateDocument(value: unknown): DagDocument {
  const parsed = dagDocumentSchema.safeParse(value)
  if (!parsed.success) throw new OrchestrationError('validation', 'Invalid DAG document')
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > MAX_DAG_CONTENT_BYTES) {
    throw new OrchestrationError('payload_too_large', 'DAG document exceeds 1 MiB')
  }
  return parsed.data
}

export const listDags = defineAuthorizedWorkspaceUseCase({
  operation: dagOperations.list,
  resolveContext: ({ input }: { input: WorkspaceDagInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ context }) => ({ dags: await listWorkspaceDags(context.workspaceId) }),
})

export const readDag = defineAuthorizedWorkspaceUseCase({
  operation: dagOperations.read,
  resolveContext: ({ input }: { input: ReadDagInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ input, context }) => ({
    dag: await readWorkspaceDag(context.workspaceId, input.dagId),
  }),
})

export const createDag = defineAuthorizedWorkspaceUseCase({
  operation: dagOperations.create,
  resolveContext: ({ input }: { input: CreateDagInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    const document = validateDocument(
      createDagDocument({
        id: generateId(),
        name: input.name,
        repository: input.repository,
        remote: input.remote,
        defaultBranch: input.defaultBranch,
      })
    )
    return { dag: await insertWorkspaceDag(context.workspaceId, document) }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.DAG_CREATED,
    resourceType: AuditResourceType.DAG,
    resourceId: result.dag.id,
    resourceName: result.dag.name,
  }),
})

export const updateDag = defineAuthorizedWorkspaceUseCase({
  operation: dagOperations.update,
  resolveContext: ({ input }: { input: UpdateDagInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    const document = validateDocument(input.document)
    if (document.id !== input.dagId || document.revision !== input.expectedRevision + 1) {
      throw new OrchestrationError(
        'validation',
        'DAG identity must match the route and revision must advance exactly once'
      )
    }
    return { dag: await updateWorkspaceDag(context.workspaceId, document, input.expectedRevision) }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.DAG_UPDATED,
    resourceType: AuditResourceType.DAG,
    resourceId: result.dag.id,
    resourceName: result.dag.name,
    metadata: { revision: result.dag.revision },
  }),
})

/** Explicit, idempotent cutover. Reads never import, initialize, or repair business data. */
export const importLegacyDag = defineAuthorizedWorkspaceUseCase({
  operation: dagOperations.importLegacy,
  resolveContext: ({ input }: { input: ImportLegacyDagInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }) {
    const existing = await findDagByLegacyFile(context.workspaceId, input.fileId)
    if (existing) return { dag: existing, imported: false }
    const { file, content } = await readWorkspaceFileContent.execute({
      principal,
      input: {
        fileId: input.fileId,
        assertedWorkspaceId: context.workspaceId,
        maxBytes: MAX_DAG_CONTENT_BYTES,
      },
    })
    let raw: unknown
    try {
      raw = JSON.parse(content.toString('utf8'))
    } catch {
      throw new OrchestrationError('validation', 'The source file is not a JSON DAG document')
    }
    const document = validateDocument(raw)
    if (file.name !== getPlanFileName(document.id) || !isDeepStrictEqual(raw, document)) {
      throw new OrchestrationError(
        'validation',
        'The source file must match the DAG identity and schema without losing fields'
      )
    }
    if (
      document.items.some(
        (item) =>
          item.execution?.lease.state === 'active' &&
          Date.parse(item.execution.lease.expiresAt) > Date.now()
      )
    ) {
      throw new OrchestrationError(
        'conflict',
        'Wait for active DAG writer leases to finish before migrating'
      )
    }
    const contentUpdatedAt = file.contentUpdatedAt
    if (!contentUpdatedAt) throw new Error('The source file has no content version')
    const dag = await db.transaction(async (tx) => {
      await archiveWorkspaceFileVersionInTx(tx, {
        workspaceId: context.workspaceId,
        fileId: file.id,
        key: file.key,
        contentUpdatedAt,
      })
      return insertWorkspaceDag(context.workspaceId, document, tx, file.id)
    })
    return { dag, imported: true }
  },
  projectAudit: ({ input, result }) =>
    result.imported
      ? [
          {
            action: AuditAction.DAG_IMPORTED,
            resourceType: AuditResourceType.DAG,
            resourceId: result.dag.id,
            resourceName: result.dag.name,
            metadata: { sourceFileId: input.fileId, revision: result.dag.revision },
          },
          {
            action: AuditAction.FILE_DELETED,
            resourceType: AuditResourceType.FILE,
            resourceId: input.fileId,
            description: 'Archived legacy DAG file after atomic database migration',
          },
        ]
      : [],
  afterSuccess: async ({ context, result }) => {
    if (result.imported) await notifyWorkspaceFilesChanged(context.workspaceId)
  },
})
