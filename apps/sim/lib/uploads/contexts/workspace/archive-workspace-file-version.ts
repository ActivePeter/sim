import { workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'

interface ArchiveWorkspaceFileVersionInput {
  workspaceId: string
  fileId: string
  key: string
  contentUpdatedAt: Date
}

/** Archives exactly the bytes a migration consumed; its caller owns the enclosing transaction. */
export async function archiveWorkspaceFileVersionInTx(
  tx: DbTransaction,
  input: ArchiveWorkspaceFileVersionInput
): Promise<void> {
  const predicate = and(
    eq(workspaceFiles.workspaceId, input.workspaceId),
    eq(workspaceFiles.id, input.fileId),
    eq(workspaceFiles.context, 'workspace'),
    isNull(workspaceFiles.deletedAt)
  )
  const [row] = await tx
    .select({ key: workspaceFiles.key, contentUpdatedAt: workspaceFiles.contentUpdatedAt })
    .from(workspaceFiles)
    .where(predicate)
    .for('update')
    .limit(1)
  if (
    !row ||
    row.key !== input.key ||
    row.contentUpdatedAt.getTime() !== input.contentUpdatedAt.getTime()
  ) {
    throw new OrchestrationError(
      'conflict',
      'The source file changed during migration; reload before retrying'
    )
  }
  await tx
    .update(workspaceFiles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(predicate)
}
