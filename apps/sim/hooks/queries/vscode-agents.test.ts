/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: api.request }))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  mothershipChatKeys: { workspaceLists: (id: string) => ['chats', id] },
}))

import { DEFAULT_PROJECT_AGENT_CONFIG } from '@/lib/vibe-vscode/agent-config'
import type { VscodeCreateChatRequest } from '@/lib/vibe-vscode/types'
import {
  useCreateProjectSessionFromSelection,
  useProjectAgentConfig,
  useUpdateProjectAgentConfig,
  vscodeAgentKeys,
  waitForProjectedVscodeHost,
} from '@/hooks/queries/vscode-agents'

const request: VscodeCreateChatRequest = {
  workspaceId: 'sim-one',
  requestId: '00000000-0000-4000-8000-000000000001',
  catalog: {
    physicalWorkspace: { id: 'physical-one', name: 'One', remoteAuthority: '', folders: [] },
    logicalWorkspaces: [],
  },
  projectUri: 'file:///projects/a',
  selection: {
    uri: 'file:///projects/a/source.ts',
    language: 'typescript',
    text: 'let a = 1',
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 9 },
  },
}
const host = {
  id: 'host-one',
  catalog: request.catalog,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
}
let queryClient: QueryClient
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
  })
})
afterEach(() => {
  queryClient.clear()
})

describe('native project Agent configuration queries', () => {
  const configData = { config: DEFAULT_PROJECT_AGENT_CONFIG, agentLocked: false, agents: [] }
  const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG

  it('scopes each read by both workspace and chat and forwards cancellation', async () => {
    api.request.mockResolvedValue(configData)
    function Consumer() {
      useProjectAgentConfig('workspace-one', 'chat-one')
      useProjectAgentConfig('workspace-two', 'chat-two')
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          createElement(QueryClientProvider, { client: queryClient }, createElement(Consumer))
        )
      )
      await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(2))
      expect(
        api.request.mock.calls.map(([contract, input]) => ({
          method: contract.method,
          params: input.params,
          query: input.query,
          signal: input.signal instanceof AbortSignal,
        }))
      ).toEqual([
        {
          method: 'GET',
          params: { chatId: 'chat-one' },
          query: { workspaceId: 'workspace-one' },
          signal: true,
        },
        {
          method: 'GET',
          params: { chatId: 'chat-two' },
          query: { workspaceId: 'workspace-two' },
          signal: true,
        },
      ])
      expect(queryClient.getQueryData(vscodeAgentKeys.config('workspace-one', 'chat-one'))).toEqual(
        configData
      )
      expect(queryClient.getQueryData(vscodeAgentKeys.config('workspace-two', 'chat-two'))).toEqual(
        configData
      )
    } finally {
      act(() => root.unmount())
    }
  })

  it('does not let an old save result replace a newer revision or another chat', async () => {
    const key = vscodeAgentKeys.config('workspace-one', 'chat-one')
    const otherKey = vscodeAgentKeys.config('workspace-two', 'chat-two')
    queryClient.setQueryData(key, configData)
    queryClient.setQueryData(otherKey, configData)
    let resolve!: (value: {
      config: typeof DEFAULT_PROJECT_AGENT_CONFIG
      agentLocked: boolean
    }) => void
    api.request.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    let mutation!: ReturnType<typeof useUpdateProjectAgentConfig>
    function Consumer() {
      mutation = useUpdateProjectAgentConfig()
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      act(() =>
        root.render(
          createElement(QueryClientProvider, { client: queryClient }, createElement(Consumer))
        )
      )
      await act(async () => {
        const pending = mutation.mutateAsync({
          chatId: 'chat-one',
          body: { workspaceId: 'workspace-one', expectedRevision: 0, settings },
        })
        await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce())
        const newer = {
          ...configData,
          config: { ...DEFAULT_PROJECT_AGENT_CONFIG, revision: 3, model: 'newer-model' },
        }
        queryClient.setQueryData(key, newer)
        resolve({ config: { ...DEFAULT_PROJECT_AGENT_CONFIG, revision: 1 }, agentLocked: false })
        await pending
        expect(queryClient.getQueryData(key)).toEqual(newer)
        expect(queryClient.getQueryData(otherKey)).toEqual(configData)
      })
      expect(api.request.mock.calls[0][1]).toEqual({
        params: { chatId: 'chat-one' },
        body: { workspaceId: 'workspace-one', expectedRevision: 0, settings },
      })
    } finally {
      act(() => root.unmount())
    }
  })
})

describe('selection creation waits for the existing host projection', () => {
  it('uses the canonical host without republishing the captured catalog', async () => {
    api.request.mockResolvedValueOnce({ hosts: [host] })
    expect(
      await waitForProjectedVscodeHost(queryClient, request, new AbortController().signal)
    ).toBe(host)
    expect(api.request).toHaveBeenCalledTimes(1)
    expect(api.request.mock.calls[0][0].method).toBe('GET')
  })

  it('waits across initial projection and never consumes another Sim workspace or remote authority', async () => {
    api.request.mockResolvedValueOnce({ hosts: [] })
    const subscribe = vi.spyOn(queryClient.getQueryCache(), 'subscribe')
    const pending = waitForProjectedVscodeHost(queryClient, request, new AbortController().signal)
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    let resolved = false
    void pending.then(() => {
      resolved = true
    })
    queryClient.setQueryData(vscodeAgentKeys.hostList('sim-two'), { hosts: [host] })
    queryClient.setQueryData(vscodeAgentKeys.hostList(request.workspaceId), {
      hosts: [
        {
          ...host,
          catalog: {
            ...host.catalog,
            physicalWorkspace: {
              ...host.catalog.physicalWorkspace,
              remoteAuthority: 'different.test',
            },
          },
        },
      ],
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    queryClient.setQueryData(vscodeAgentKeys.hostList(request.workspaceId), { hosts: [host] })
    expect(await pending).toEqual(host)
    expect(api.request).toHaveBeenCalledTimes(1)
  })

  it('releases the readiness subscription when the bridge closes or the request times out', async () => {
    api.request.mockResolvedValueOnce({ hosts: [] })
    const subscribe = vi.spyOn(queryClient.getQueryCache(), 'subscribe')
    const controller = new AbortController()
    const pending = waitForProjectedVscodeHost(queryClient, request, controller.signal)
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toThrow('项目目录尚未同步')
    queryClient.setQueryData(vscodeAgentKeys.hostList(request.workspaceId), { hosts: [host] })
  })

  it('does not start a shared query for an already-cancelled creation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      waitForProjectedVscodeHost(queryClient, request, controller.signal)
    ).rejects.toThrow()
    expect(api.request).not.toHaveBeenCalled()
  })

  it('cancels a stalled host lookup without aborting the query used by other consumers', async () => {
    let complete!: (value: { hosts: (typeof host)[] }) => void
    api.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    const controller = new AbortController()
    const pending = waitForProjectedVscodeHost(queryClient, request, controller.signal)
    const failure = expect(pending).rejects.toThrow('创建 Sim Chat 超时或已取消')
    controller.abort()
    await failure
    expect(api.request.mock.calls[0][1].signal.aborted).toBe(false)
    complete({ hosts: [host] })
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(vscodeAgentKeys.hostList(request.workspaceId))).toEqual({
        hosts: [host],
      })
    )
  })

  it('bounds the caller wait after native creation starts and accepts its late completion', async () => {
    let complete!: (value: { id: string; workspaceId: string }) => void
    api.request.mockResolvedValueOnce({ hosts: [host] })
    api.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        })
    )
    let create!: ReturnType<typeof useCreateProjectSessionFromSelection>
    function Consumer() {
      create = useCreateProjectSessionFromSelection()
      return null
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      act(() =>
        root.render(
          createElement(QueryClientProvider, { client: queryClient }, createElement(Consumer))
        )
      )
      await act(async () => {
        const controller = new AbortController()
        const pending = create(request, controller.signal)
        const failure = expect(pending).rejects.toThrow('创建 Sim Chat 超时或已取消')
        await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(2))
        controller.abort()
        await failure
        expect(api.request.mock.calls[1][1].body.requestId).toBe(request.requestId)
        complete({ id: 'created', workspaceId: request.workspaceId })
        await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0))
      })
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
