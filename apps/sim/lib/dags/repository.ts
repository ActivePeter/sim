import { db } from '@sim/db'
import { workspaceDag } from '@sim/db/schema'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { and, asc, eq, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type DagDocument, dagDocumentSchema } from '@/lib/dags/model'
import type { DbOrTx } from '@/lib/db/types'

/** Every DAG lookup, including ID-based writes, is scoped to its canonical workspace. */
export async function listWorkspaceDags(workspaceId: string) {
  const rows = await db
    .select({
      id: workspaceDag.id,
      name: sql<string>`${workspaceDag.document}->>'name'`,
      repository: sql<string>`${workspaceDag.document}->>'repository'`,
      revision: sql<number>`(${workspaceDag.document}->>'revision')::double precision`,
    })
    .from(workspaceDag)
    .where(eq(workspaceDag.workspaceId, workspaceId))
    .orderBy(asc(workspaceDag.createdAt), asc(workspaceDag.id))
    .limit(1_001)
  if (rows.length > 1_000)
    throw new OrchestrationError('payload_too_large', 'DAG list exceeds 1000 documents')
  return rows
}

export async function readWorkspaceDag(workspaceId: string, dagId: string): Promise<DagDocument> {
  const [row] = await db
    .select({ document: workspaceDag.document })
    .from(workspaceDag)
    .where(and(eq(workspaceDag.workspaceId, workspaceId), eq(workspaceDag.id, dagId)))
    .limit(1)
  if (!row) throw new OrchestrationError('not_found', 'DAG not found')
  return dagDocumentSchema.parse(row.document)
}

export async function findDagByLegacyFile(
  workspaceId: string,
  fileId: string
): Promise<DagDocument | undefined> {
  const [row] = await db
    .select({ document: workspaceDag.document })
    .from(workspaceDag)
    .where(and(eq(workspaceDag.workspaceId, workspaceId), eq(workspaceDag.legacyFileId, fileId)))
    .limit(1)
  return row ? dagDocumentSchema.parse(row.document) : undefined
}

export async function insertWorkspaceDag(
  workspaceId: string,
  document: DagDocument,
  executor: DbOrTx = db,
  legacyFileId?: string
): Promise<DagDocument> {
  try {
    const [row] = await executor
      .insert(workspaceDag)
      .values({ workspaceId, id: document.id, document, legacyFileId })
      .returning({ document: workspaceDag.document })
    return dagDocumentSchema.parse(row.document)
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505')
      throw new OrchestrationError('conflict', 'DAG already exists')
    throw error
  }
}

/** CAS is checked by PostgreSQL in the same statement that replaces the document. */
export async function updateWorkspaceDag(
  workspaceId: string,
  document: DagDocument,
  expectedRevision: number
): Promise<DagDocument> {
  const [row] = await db
    .update(workspaceDag)
    .set({ document, updatedAt: new Date() })
    .where(
      and(
        eq(workspaceDag.workspaceId, workspaceId),
        eq(workspaceDag.id, document.id),
        sql`${workspaceDag.document}->>'revision' = ${String(expectedRevision)}`
      )
    )
    .returning({ document: workspaceDag.document })
  if (!row) {
    await readWorkspaceDag(workspaceId, document.id)
    throw new OrchestrationError('conflict', 'DAG changed since it was read; reload before saving')
  }
  return dagDocumentSchema.parse(row.document)
}
