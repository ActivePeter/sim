/**
 * @vitest-environment node
 */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')

import { db } from '@sim/db'
import { createTestDag } from '@/lib/dags/model.test-fixtures'
import {
  findDagByLegacyFile,
  insertWorkspaceDag,
  listWorkspaceDags,
  readWorkspaceDag,
  updateWorkspaceDag,
} from '@/lib/dags/repository'
import { archiveWorkspaceFileVersionInTx } from '@/lib/uploads/contexts/workspace/archive-workspace-file-version'

const dialect = new PgDialect()
const document = createTestDag('database-dag')
function predicate(index = 0) {
  return dialect.sqlToQuery(dbChainMockFns.where.mock.calls[index][0])
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('workspace DAG repository', () => {
  it('scopes ID reads to the workspace and leaves unknown IDs missing', async () => {
    await expect(readWorkspaceDag('workspace-1', document.id)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(predicate()).toMatchObject({ params: ['workspace-1', document.id] })
    expect(predicate().sql).toContain('"workspace_dag"."workspace_id"')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('lists only persisted summaries and refuses silently truncated lists', async () => {
    const summary = {
      id: document.id,
      name: document.name,
      repository: document.repository,
      revision: document.revision,
    }
    dbChainMockFns.limit.mockResolvedValueOnce([summary])
    expect(await listWorkspaceDags('workspace-1')).toEqual([summary])
    expect(predicate().params).toEqual(['workspace-1'])
    dbChainMockFns.limit.mockResolvedValueOnce(Array.from({ length: 1_001 }, () => summary))
    await expect(listWorkspaceDags('workspace-1')).rejects.toMatchObject({
      code: 'payload_too_large',
    })
  })
  it('atomically predicates updates on workspace, ID, and the last-read revision', async () => {
    const next = { ...document, name: 'Changed', revision: 2 }
    dbChainMockFns.returning.mockResolvedValueOnce([{ document: next }])
    expect(await updateWorkspaceDag('workspace-1', next, 1)).toEqual(next)
    expect(predicate().params).toEqual(['workspace-1', document.id, '1'])
    expect(predicate().sql).toContain("->>'revision'")
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ document: next, updatedAt: expect.any(Date) })
  })
  it('distinguishes an existing revision conflict from a missing DAG', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([{ document }])
    await expect(updateWorkspaceDag('workspace-1', document, 1)).rejects.toMatchObject({
      code: 'conflict',
    })
    dbChainMockFns.returning.mockResolvedValueOnce([])
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(updateWorkspaceDag('workspace-1', document, 1)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
  it('keeps legacy-import idempotency lookups inside the same workspace', async () => {
    expect(await findDagByLegacyFile('workspace-1', 'file-1')).toBeUndefined()
    expect(predicate().params).toEqual(['workspace-1', 'file-1'])
  })
  it('does not swallow database errors or turn them into empty data', async () => {
    dbChainMockFns.limit.mockRejectedValueOnce(new Error('database offline'))
    await expect(readWorkspaceDag('workspace-1', document.id)).rejects.toThrow('database offline')
    dbChainMockFns.returning.mockRejectedValueOnce(new Error('insert offline'))
    await expect(insertWorkspaceDag('workspace-1', document)).rejects.toThrow('insert offline')
  })
  it('maps a uniqueness violation to a conflict', async () => {
    dbChainMockFns.returning.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: '23505' })
    )
    await expect(insertWorkspaceDag('workspace-1', document)).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})

describe('legacy file version fence', () => {
  const version = {
    workspaceId: 'workspace-1',
    fileId: 'file-1',
    key: 'old-key',
    contentUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
  }
  it('locks and archives only the matching active workspace file version', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { key: version.key, contentUpdatedAt: version.contentUpdatedAt },
    ])
    await db.transaction((tx) => archiveWorkspaceFileVersionInTx(tx, version))
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(predicate().params).toEqual(['workspace-1', 'file-1', 'workspace'])
    expect(predicate().sql).toContain('"workspace_files"."deleted_at" is null')
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    })
  })
  it.each([
    { rows: [] },
    { rows: [{ key: 'new-key', contentUpdatedAt: version.contentUpdatedAt }] },
    { rows: [{ key: version.key, contentUpdatedAt: new Date('2026-09-01T00:00:01.000Z') }] },
  ])('does not archive a missing or concurrently edited source (%j)', async ({ rows }) => {
    dbChainMockFns.limit.mockResolvedValueOnce(rows)
    await expect(
      db.transaction((tx) => archiveWorkspaceFileVersionInTx(tx, version))
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
})
