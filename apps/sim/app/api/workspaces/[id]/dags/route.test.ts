/**
 * @vitest-environment node
 */
import { authMock, authMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  importLegacy: vi.fn(),
}))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/dags/application/dags', () => ({
  listDags: { operation: { id: 'dags.list' }, execute: mocks.list },
  readDag: { operation: { id: 'dags.read' }, execute: mocks.read },
  createDag: { operation: { id: 'dags.create' }, execute: mocks.create },
  updateDag: { operation: { id: 'dags.update' }, execute: mocks.update },
  importLegacyDag: { operation: { id: 'dags.import_legacy' }, execute: mocks.importLegacy },
}))

import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createTestDag } from '@/lib/dags/model.test-fixtures'
import { POST as importLegacy } from '@/app/api/workspaces/[id]/dag-imports/route'
import { GET as read, PUT as update } from '@/app/api/workspaces/[id]/dags/[dagId]/route'
import { POST as create, GET as list } from '@/app/api/workspaces/[id]/dags/route'

const document = createTestDag('new-database-dag')
const context = { params: Promise.resolve({ id: 'workspace-1', dagId: document.id }) }
function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/workspaces/workspace-1/dags', {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'viewer-1' },
    session: { id: 'session-1' },
  })
  mocks.list.mockResolvedValue({ dags: [] })
  mocks.read.mockResolvedValue({ dag: document })
  mocks.create.mockResolvedValue({ dag: document })
  mocks.update.mockResolvedValue({ dag: { ...document, revision: 2 } })
  mocks.importLegacy.mockResolvedValue({ dag: document, imported: true })
})
describe('internal DAG API adapters', () => {
  it('authenticates before parsing invalid bodies or looking up documents', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    expect((await update(request('PUT', { invalid: true }), context)).status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('preserves an empty list and does not create or import from a GET', async () => {
    const response = await list(request('GET'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ dags: [] })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.importLegacy).not.toHaveBeenCalled()
  })
  it('forwards the real session and asserted workspace into the same read use case', async () => {
    const response = await read(request('GET'), context)
    expect(await response.json()).toEqual({ dag: document })
    expect(mocks.read).toHaveBeenCalledWith({
      principal: { kind: 'session', userId: 'viewer-1', sessionId: 'session-1' },
      input: { workspaceId: 'workspace-1', dagId: document.id },
      request: expect.anything(),
    })
  })
  it('requires explicit creation metadata and returns the persisted result', async () => {
    expect((await create(request('POST', { name: 'No repository' }), context)).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
    const response = await create(
      request('POST', {
        name: 'New graph',
        repository: 'example/repo',
        remote: 'origin',
        defaultBranch: 'trunk',
      }),
      context
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ dag: document })
  })
  it('requires a revision token for writes', async () => {
    expect((await update(request('PUT', { document }), context)).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(
      (
        await update(
          request('PUT', { document: { ...document, revision: 2 }, expectedRevision: 1 }),
          context
        )
      ).status
    ).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          workspaceId: 'workspace-1',
          dagId: document.id,
          document: { ...document, revision: 2 },
          expectedRevision: 1,
        },
      })
    )
  })
  it.each([
    ['conflict', 409],
    ['not_found', 404],
  ] as const)('projects %s without an implicit fallback', async (code, status) => {
    mocks.update.mockRejectedValueOnce(new OrchestrationError(code, 'Expected error'))
    expect(
      (
        await update(
          request('PUT', { document: { ...document, revision: 2 }, expectedRevision: 1 }),
          context
        )
      ).status
    ).toBe(status)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('conceals cross-workspace existence and keeps infrastructure failures as failures', async () => {
    mocks.read.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await read(request('GET'), context)).status).toBe(404)
    mocks.read.mockRejectedValueOnce(new Error('private database error'))
    const response = await read(request('GET'), context)
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('private database error')
  })
  it('performs an explicit import through the compound authorized use case', async () => {
    const response = await importLegacy(request('POST', { fileId: 'file-1' }), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ dag: document })
    expect(mocks.importLegacy).toHaveBeenCalledWith(
      expect.objectContaining({ input: { workspaceId: 'workspace-1', fileId: 'file-1' } })
    )
  })
})
