/**
 * @vitest-environment node
 */
import type { Principal } from '@sim/auth/principal'
import {
  auditMock,
  auditMockFns,
  dbChainMock,
  dbChainMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DagDocument } from '@/lib/dags/model'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  permission: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  findLegacy: vi.fn(),
  readFile: vi.fn(),
  archive: vi.fn(),
  notify: vi.fn(),
}))
vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/db', () => dbChainMock)
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string, required: string) =>
    ['read', 'write', 'admin'].indexOf(actual) >= ['read', 'write', 'admin'].indexOf(required),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.context,
}))
vi.mock('@/lib/dags/repository', () => ({
  listWorkspaceDags: mocks.list,
  readWorkspaceDag: mocks.read,
  insertWorkspaceDag: mocks.insert,
  updateWorkspaceDag: mocks.update,
  findDagByLegacyFile: mocks.findLegacy,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: mocks.readFile },
}))
vi.mock('@/lib/uploads/contexts/workspace/archive-workspace-file-version', () => ({
  archiveWorkspaceFileVersionInTx: mocks.archive,
}))
vi.mock('@/lib/realtime/notify', () => ({ notifyWorkspaceFilesChanged: mocks.notify }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createDag,
  importLegacyDag,
  listDags,
  readDag,
  updateDag,
} from '@/lib/dags/application/dags'
import { createTestDag } from '@/lib/dags/model.test-fixtures'

const principal: Principal = { kind: 'session', userId: 'viewer-1', sessionId: 'session-1' }
const workspaceId = 'workspace-1'
const context = {
  workspaceId,
  workspaceOrganizationId: null,
  allowPersonalApiKeys: true,
  billedAccountUserId: 'billing-owner',
}
let document: DagDocument
const input = { workspaceId, dagId: 'arbitrary-database-dag' }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  document = createTestDag(input.dagId)
  mocks.context.mockResolvedValue(context)
  mocks.permission.mockResolvedValue('write')
  mocks.list.mockResolvedValue([])
  mocks.read.mockImplementation(async () => document)
  mocks.insert.mockImplementation(async (_workspaceId, dag) => dag)
  mocks.update.mockImplementation(async (_workspaceId, dag) => dag)
  mocks.findLegacy.mockResolvedValue(undefined)
  mocks.archive.mockResolvedValue(undefined)
  mocks.notify.mockResolvedValue(undefined)
  mocks.readFile.mockResolvedValue({
    file: {
      id: 'file-1',
      name: 'sim-plan-arbitrary-database-dag.json',
      key: 'versioned-key',
      contentUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    content: Buffer.from(JSON.stringify(document)),
  })
})

describe('DAG application authority', () => {
  it('returns a genuinely empty workspace without creating a document', async () => {
    expect(await listDags.execute({ principal, input: { workspaceId } })).toEqual({ dags: [] })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.readFile).not.toHaveBeenCalled()
  })
  it.each<Principal>([
    principal,
    { kind: 'personal_api_key', userId: 'viewer-1', keyId: 'personal-key' },
    { kind: 'workspace_api_key', workspaceId, keyId: 'workspace-key' },
  ])('reads database documents with the declared principal kind ($kind)', async (actor) => {
    expect(await readDag.execute({ principal: actor, input })).toEqual({ dag: document })
    expect(mocks.read).toHaveBeenCalledWith(workspaceId, input.dagId)
    expect(mocks.readFile).not.toHaveBeenCalled()
  })
  it('allows read-only access but rejects a write before touching the repository', async () => {
    mocks.permission.mockResolvedValue('read')
    await readDag.execute({ principal, input })
    await expect(
      updateDag.execute({
        principal,
        input: { ...input, document: { ...document, revision: 2 }, expectedRevision: 1 },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
  it('rejects unregistered delegated principals before canonical loading', async () => {
    const delegated: Principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: 'viewer-1',
      workspaceId,
      delegationId: 'execution-1',
      audience: 'files',
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    }
    await expect(readDag.execute({ principal: delegated, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('denies a workspace key for another workspace without reading DAG data', async () => {
    await expect(
      readDag.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'other-workspace', keyId: 'key' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('rechecks current personal-key policy and current human membership', async () => {
    mocks.context.mockResolvedValue({ ...context, allowPersonalApiKeys: false })
    await expect(
      readDag.execute({
        principal: { kind: 'personal_api_key', userId: 'viewer-1', keyId: 'key' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    mocks.permission.mockResolvedValue(null)
    await expect(readDag.execute({ principal, input })).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('propagates infrastructure errors instead of treating them as an empty workspace', async () => {
    mocks.list.mockRejectedValueOnce(new Error('database offline'))
    await expect(listDags.execute({ principal, input: { workspaceId } })).rejects.toThrow(
      'database offline'
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('creates an empty DAG only from explicitly supplied metadata', async () => {
    const metadata = {
      name: 'Database name',
      repository: 'example/repo',
      remote: 'origin',
      defaultBranch: 'trunk',
    }
    const result = await createDag.execute({ principal, input: { workspaceId, ...metadata } })
    expect(result.dag).toMatchObject({
      ...metadata,
      revision: 1,
      items: [],
      dependencies: [],
      positions: {},
      sizes: {},
    })
    expect(result.dag.id).not.toBe(document.id)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'viewer-1',
        resourceId: result.dag.id,
        action: 'dag.created',
      })
    )
  })
  it('preserves all stored content and audits the actual workspace-key actor on update', async () => {
    const next = { ...document, revision: 2, name: 'New database name' }
    const actor: Principal = { kind: 'workspace_api_key', workspaceId, keyId: 'actual-key' }
    expect(
      await updateDag.execute({
        principal: actor,
        input: { ...input, document: next, expectedRevision: 1 },
      })
    ).toEqual({ dag: next })
    expect(mocks.update).toHaveBeenCalledWith(workspaceId, next, 1)
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        metadata: expect.objectContaining({
          actor: { kind: 'workspace_api_key', workspaceId, keyId: 'actual-key' },
        }),
      })
    )
  })
  it.each([{ id: 'different-id', revision: 2 }, { revision: 1 }, { revision: 3 }])(
    'rejects forged identity or nonconsecutive revision (%j)',
    async (change) => {
      await expect(
        updateDag.execute({
          principal,
          input: { ...input, document: { ...document, ...change }, expectedRevision: 1 },
        })
      ).rejects.toMatchObject({ code: 'validation' })
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )
  it('does not audit an optimistic-concurrency conflict', async () => {
    mocks.update.mockRejectedValueOnce(new OrchestrationError('conflict', 'Revision conflict'))
    await expect(
      updateDag.execute({
        principal,
        input: { ...input, document: { ...document, revision: 2 }, expectedRevision: 1 },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
})

describe('explicit legacy DAG cutover', () => {
  it('archives the exact source version and inserts the unchanged DAG in one transaction', async () => {
    const result = await importLegacyDag.execute({
      principal,
      input: { workspaceId, fileId: 'file-1' },
    })
    expect(result).toEqual({ dag: document, imported: true })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.archive).toHaveBeenCalledWith(
      dbChainMock.db,
      expect.objectContaining({ workspaceId, fileId: 'file-1', key: 'versioned-key' })
    )
    expect(mocks.insert).toHaveBeenCalledWith(workspaceId, document, dbChainMock.db, 'file-1')
    expect(mocks.readFile).toHaveBeenCalledWith({
      principal,
      input: expect.objectContaining({ fileId: 'file-1', assertedWorkspaceId: workspaceId }),
    })
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledTimes(2)
    expect(mocks.notify).toHaveBeenCalledWith(workspaceId)
  })
  it('is idempotent and never imports the archived file a second time', async () => {
    mocks.findLegacy.mockResolvedValue(document)
    expect(
      await importLegacyDag.execute({ principal, input: { workspaceId, fileId: 'file-1' } })
    ).toEqual({ dag: document, imported: false })
    expect(mocks.readFile).not.toHaveBeenCalled()
    expect(mocks.archive).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
  })
  it('aborts a changed source before inserting a DAG or projecting success', async () => {
    mocks.archive.mockRejectedValueOnce(new OrchestrationError('conflict', 'Source changed'))
    await expect(
      importLegacyDag.execute({ principal, input: { workspaceId, fileId: 'file-1' } })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('does not report a successful archive when the enclosing insert transaction fails', async () => {
    mocks.insert.mockRejectedValueOnce(new OrchestrationError('conflict', 'DAG already exists'))
    await expect(
      importLegacyDag.execute({ principal, input: { workspaceId, fileId: 'file-1' } })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(auditMockFns.mockRecordAudit).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('will not silently discard unknown source fields', async () => {
    mocks.readFile.mockResolvedValue({
      file: { name: 'sim-plan-arbitrary-database-dag.json' },
      content: Buffer.from(JSON.stringify({ ...document, futureField: 'keep me' })),
    })
    await expect(
      importLegacyDag.execute({ principal, input: { workspaceId, fileId: 'file-1' } })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.archive).not.toHaveBeenCalled()
  })
})
