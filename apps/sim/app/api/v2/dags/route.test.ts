/**
 * @vitest-environment node
 */
import {
  MockV2ApiKeyUnauthenticatedError,
  v2ApiKeyAuthModuleMock,
  v2RateLimiterModuleMock,
  v2RouteMocks,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => v2ApiKeyAuthModuleMock)
vi.mock('@/lib/core/rate-limiter', () => v2RateLimiterModuleMock)
vi.mock('@/lib/dags/application/dags', () => ({
  listDags: { operation: { id: 'dags.list' }, execute: mocks.list },
  readDag: { operation: { id: 'dags.read' }, execute: mocks.read },
  updateDag: { operation: { id: 'dags.update' }, execute: mocks.update },
}))

import { NoWorkspaceAccessError } from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createTestDag } from '@/lib/dags/model.test-fixtures'
import { GET as read, PUT as update } from '@/app/api/v2/dags/[dagId]/route'
import { GET as list } from '@/app/api/v2/dags/route'

const dag = createTestDag('not-a-compiled-catalog-id')
const principal = {
  kind: 'workspace_api_key',
  workspaceId: 'workspace-1',
  keyId: 'test-key',
} as const
const context = { params: Promise.resolve({ dagId: dag.id }) }
const allowedRate = { allowed: true, remaining: 99, resetAt: new Date('2026-09-01T00:00:00.000Z') }
function request(method = 'GET', body?: unknown) {
  return new NextRequest(
    `http://localhost/api/v2/dags/${dag.id}${method === 'GET' ? '?workspaceId=workspace-1' : ''}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  v2RouteMocks.authenticate.mockResolvedValue({
    principal,
    rateLimitSubjectIds: ['api-key:test-key'],
    rateLimitSubscription: null,
    keyType: 'workspace',
    keyExpiresAt: null,
  })
  v2RouteMocks.preauthRate.mockResolvedValue(allowedRate)
  v2RouteMocks.operationRate.mockResolvedValue(allowedRate)
  mocks.list.mockResolvedValue({ dags: [] })
  mocks.read.mockResolvedValue({ dag })
  mocks.update.mockResolvedValue({ dag: { ...dag, revision: 2 } })
})
describe('Agent DAG API', () => {
  it('authenticates API keys before parsing writes', async () => {
    v2RouteMocks.authenticate.mockRejectedValueOnce(new MockV2ApiKeyUnauthenticatedError())
    expect((await update(request('PUT', { invalid: true }), context)).status).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('shares database reads with the internal surface without legacy file discovery', async () => {
    const response = await read(request(), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: dag })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ principal, input: { workspaceId: 'workspace-1', dagId: dag.id } })
    )
    expect(await (await list(request())).json()).toEqual({ data: [] })
  })
  it('forwards a revision-based write and preserves the conflict status', async () => {
    const body = {
      workspaceId: 'workspace-1',
      document: { ...dag, revision: 2 },
      expectedRevision: 1,
    }
    expect((await update(request('PUT', body), context)).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ principal, input: { ...body, dagId: dag.id } })
    )
    mocks.update.mockRejectedValueOnce(new OrchestrationError('conflict', 'Revision conflict'))
    expect((await update(request('PUT', body), context)).status).toBe(409)
  })
  it('conceals inaccessible workspaces with the same 404 as an unknown DAG', async () => {
    mocks.read.mockRejectedValueOnce(new NoWorkspaceAccessError())
    expect((await read(request(), context)).status).toBe(404)
  })
})
