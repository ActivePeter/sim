/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateDagBody } from '@/lib/api/contracts/dags'
import type { DagDocument } from '@/lib/dags/model'

const mocks = vi.hoisted(() => ({ request: vi.fn(), toastError: vi.fn() }))
vi.mock('@sim/emcn', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))

import { ApiClientError } from '@/lib/api/client/errors'
import { createTestDag } from '@/lib/dags/model.test-fixtures'
import { usePersistedDag } from '@/app/workspace/[workspaceId]/d/[dagId]/hooks/use-persisted-dag'
import { dagKeys } from '@/hooks/queries/dags'

const WORKSPACE_ID = 'workspace-1'
const DAG_ID = 'persisted-plan'
let root: Root
let queryClient: QueryClient
let result: ReturnType<typeof usePersistedDag>
let serverDocument: DagDocument

interface RequestInput {
  params: { id: string; dagId: string }
  body?: UpdateDagBody
  signal?: AbortSignal
}
function Probe({ workspaceId, dagId }: { workspaceId: string; dagId: string }) {
  result = usePersistedDag(workspaceId, dagId)
  return null
}
function render(workspaceId = WORKSPACE_ID, dagId = DAG_ID) {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe workspaceId={workspaceId} dagId={dagId} />
      </QueryClientProvider>
    )
  )
}
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
function writes() {
  return mocks.request.mock.calls.filter(([contract]) => contract.method === 'PUT')
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  serverDocument = createTestDag(DAG_ID)
  queryClient.setQueryData(dagKeys.detail(WORKSPACE_ID, DAG_ID), { dag: serverDocument })
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.request.mockImplementation(async (contract: { method: string }, input: RequestInput) => {
    if (contract.method === 'PUT') {
      if (!input.body) throw new Error('Missing mutation body')
      serverDocument = input.body.document as DagDocument
    }
    return { dag: serverDocument }
  })
})
afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('database-backed DAG editor persistence', () => {
  it('reads durable data without any implicit creation or reset', () => {
    render()
    expect(result.dag).toEqual(serverDocument)
    expect(result.isLoading).toBe(false)
    expect(result).not.toHaveProperty('reset')
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('shows a missing document without seeding it', async () => {
    queryClient.clear()
    mocks.request.mockRejectedValue(
      new ApiClientError({ status: 404, message: 'DAG not found', body: {} })
    )
    render()
    await flush()
    expect(result.isMissing).toBe(true)
    expect(result.isLoading).toBe(false)
    expect(result.dag).toBeUndefined()
    expect(
      result.updateDag((current) => ({
        ...current,
        name: 'Do not create',
        revision: current.revision + 1,
      }))
    ).toBe(false)
    expect(mocks.request.mock.calls.every(([contract]) => contract.method === 'GET')).toBe(true)
  })
  it('reports authorization errors without retaining an editable cached document', async () => {
    render()
    mocks.request.mockRejectedValue(
      new ApiClientError({ status: 403, message: 'Access revoked', body: {} })
    )
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: dagKeys.detail(WORKSPACE_ID, DAG_ID) })
    })
    await flush()
    expect(result.error).toBe('Access revoked')
    expect(result.dag).toBeUndefined()
    expect(result.isMissing).toBe(false)
    expect(writes()).toHaveLength(0)
  })
  it('keeps a durable DAG visible during background refresh', async () => {
    render()
    const refresh = deferred<{ dag: DagDocument }>()
    mocks.request.mockReturnValue(refresh.promise)
    void queryClient.invalidateQueries({ queryKey: dagKeys.detail(WORKSPACE_ID, DAG_ID) })
    await flush()
    expect(result.dag).toEqual(serverDocument)
    expect(result.isLoading).toBe(false)
    refresh.resolve({ dag: serverDocument })
    await flush()
  })
  it('serializes edits with the revision each edit was based on', async () => {
    render()
    const first = deferred<{ dag: DagDocument }>()
    mocks.request.mockImplementation((contract: { method: string }, input: RequestInput) => {
      if (contract.method === 'GET') return Promise.resolve({ dag: serverDocument })
      if (input.body?.expectedRevision === 1) return first.promise
      serverDocument = input.body?.document as DagDocument
      return Promise.resolve({ dag: serverDocument })
    })
    act(() => {
      result.updateDag((current) => ({
        ...current,
        name: 'First edit',
        revision: current.revision + 1,
      }))
      result.updateDag((current) => ({
        ...current,
        name: 'Second edit',
        revision: current.revision + 1,
      }))
    })
    await flush()
    expect(writes()).toHaveLength(1)
    expect(result.dag?.name).toBe('Second edit')
    expect(result.persistedDag).toEqual(serverDocument)
    expect(result.persistedDag?.name).not.toBe('Second edit')
    expect(result.isSaving).toBe(true)
    serverDocument = writes()[0][1].body.document
    first.resolve({ dag: serverDocument })
    await flush()
    await flush()
    expect(writes().map(([, input]) => input.body.expectedRevision)).toEqual([1, 2])
    expect(writes().map(([, input]) => input.body.document.name)).toEqual([
      'First edit',
      'Second edit',
    ])
    expect(result.dag?.name).toBe('Second edit')
    expect(result.persistedDag?.name).toBe('Second edit')
    expect(result.isSaving).toBe(false)
  })
  it('discards queued edits after a conflict and reloads the authoritative revision', async () => {
    render()
    const first = deferred<{ dag: DagDocument }>()
    mocks.request.mockImplementation((contract: { method: string }) =>
      contract.method === 'GET' ? Promise.resolve({ dag: serverDocument }) : first.promise
    )
    act(() => {
      result.updateDag((current) => ({
        ...current,
        name: 'Local one',
        revision: current.revision + 1,
      }))
      result.updateDag((current) => ({
        ...current,
        name: 'Local two',
        revision: current.revision + 1,
      }))
    })
    await flush()
    serverDocument = { ...serverDocument, name: 'Other writer', revision: 8 }
    first.reject(new ApiClientError({ status: 409, message: 'Revision conflict', body: {} }))
    await flush()
    await flush()
    expect(writes()).toHaveLength(1)
    expect(result.dag?.name).toBe('Other writer')
    expect(result.dag?.revision).toBe(8)
    expect(result.isSaving).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith('Revision conflict')
  })
  it('does not project an old draft or dispatch its queued write after switching workspace', async () => {
    const first = deferred<{ dag: DagDocument }>()
    mocks.request.mockImplementation((contract: { method: string }) =>
      contract.method === 'GET' ? Promise.resolve({ dag: serverDocument }) : first.promise
    )
    render()
    act(() => {
      result.updateDag((current) => ({
        ...current,
        name: 'Old draft',
        revision: current.revision + 1,
      }))
      result.updateDag((current) => ({
        ...current,
        name: 'Queued old draft',
        revision: current.revision + 1,
      }))
    })
    await flush()
    const otherDocument = { ...createTestDag(DAG_ID), name: 'Other workspace', revision: 50 }
    queryClient.setQueryData(dagKeys.detail('workspace-2', DAG_ID), { dag: otherDocument })
    render('workspace-2')
    expect(result.dag?.name).toBe('Other workspace')
    expect(result.isSaving).toBe(false)
    serverDocument = writes()[0][1].body.document
    first.resolve({ dag: serverDocument })
    await flush()
    expect(writes()).toHaveLength(1)
    expect(result.dag?.name).toBe('Other workspace')
  })
  it('does not reuse another DAG cache entry for an unknown ID', async () => {
    mocks.request.mockRejectedValue(
      new ApiClientError({ status: 404, message: 'DAG not found', body: {} })
    )
    render(WORKSPACE_ID, 'unknown-id')
    expect(result.dag).toBeUndefined()
    await flush()
    expect(result.isMissing).toBe(true)
    expect(writes()).toHaveLength(0)
  })
})
