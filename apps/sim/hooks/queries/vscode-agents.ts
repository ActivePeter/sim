import { useCallback } from 'react'
import {
  type QueryClient,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import {
  type CreateProjectSessionBody,
  createProjectSessionContract,
  type GetProjectAgentConfigResponse,
  getProjectAgentConfigContract,
  listProjectSessionsContract,
  listVscodeHostsContract,
  type StopProjectSessionBody,
  type SyncVscodeHostBody,
  stopProjectSessionContract,
  syncVscodeHostContract,
  type UpdateProjectAgentConfigBody,
  updateProjectAgentConfigContract,
} from '@/lib/api/contracts/vscode-agents'
import type { VscodeCreateChatRequest, VscodeHost } from '@/lib/vibe-vscode/types'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'

export const VSCODE_HOSTS_STALE_TIME = 30_000
export const VSCODE_SESSIONS_STALE_TIME = 2000
export const VSCODE_MONITOR_POLL_INTERVAL = 4000
export const VSCODE_AGENT_CONFIG_STALE_TIME = 10_000
export const vscodeAgentKeys = {
  all: ['vscode-agents'] as const,
  hosts: () => [...vscodeAgentKeys.all, 'hosts'] as const,
  hostList: (workspaceId: string) => [...vscodeAgentKeys.hosts(), workspaceId] as const,
  sessions: () => [...vscodeAgentKeys.all, 'sessions'] as const,
  sessionList: (workspaceId: string) => [...vscodeAgentKeys.sessions(), workspaceId] as const,
  configs: () => [...vscodeAgentKeys.all, 'config'] as const,
  config: (workspaceId: string, chatId: string) =>
    [...vscodeAgentKeys.configs(), workspaceId, chatId] as const,
}

export function useProjectAgentConfig(workspaceId: string, chatId?: string) {
  return useQuery({
    queryKey: vscodeAgentKeys.config(workspaceId, chatId ?? ''),
    queryFn: ({ signal }) =>
      requestJson(getProjectAgentConfigContract, {
        params: { chatId: chatId! },
        query: { workspaceId },
        signal,
      }),
    staleTime: VSCODE_AGENT_CONFIG_STALE_TIME,
    enabled: !!workspaceId && !!chatId,
  })
}

export function useUpdateProjectAgentConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ chatId, body }: { chatId: string; body: UpdateProjectAgentConfigBody }) =>
      requestJson(updateProjectAgentConfigContract, { params: { chatId }, body }),
    onMutate: ({ chatId, body }) =>
      queryClient.cancelQueries({ queryKey: vscodeAgentKeys.config(body.workspaceId, chatId) }),
    onSuccess: (result, { chatId, body }) => {
      queryClient.setQueryData<GetProjectAgentConfigResponse>(
        vscodeAgentKeys.config(body.workspaceId, chatId),
        (current) =>
          current && current.config.revision <= result.config.revision
            ? { ...current, ...result }
            : current
      )
    },
    onSettled: (_result, _error, { chatId, body }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: vscodeAgentKeys.config(body.workspaceId, chatId),
        }),
        queryClient.invalidateQueries({ queryKey: vscodeAgentKeys.sessionList(body.workspaceId) }),
      ]),
  })
}

export function useVscodeHosts(workspaceId: string) {
  return useQuery({
    queryKey: vscodeAgentKeys.hostList(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(listVscodeHostsContract, { query: { workspaceId }, signal }),
    staleTime: VSCODE_HOSTS_STALE_TIME,
    enabled: !!workspaceId,
  })
}

export function useSyncVscodeHost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ body, signal }: { body: SyncVscodeHostBody; signal?: AbortSignal }) =>
      requestJson(syncVscodeHostContract, { body, signal }),
    onSettled: (_data, _error, { body }) =>
      queryClient.invalidateQueries({ queryKey: vscodeAgentKeys.hostList(body.workspaceId) }),
  })
}

export function useProjectSessions(workspaceId: string) {
  return useQuery({
    queryKey: vscodeAgentKeys.sessionList(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(listProjectSessionsContract, { query: { workspaceId }, signal }),
    staleTime: VSCODE_SESSIONS_STALE_TIME,
    refetchInterval: VSCODE_MONITOR_POLL_INTERVAL,
    enabled: !!workspaceId,
  })
}

/** Each workspace keeps its own authorized query and cache scope, including failure state. */
export function useGlobalProjectSessions(workspaceIds: string[]) {
  return useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: vscodeAgentKeys.sessionList(workspaceId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        requestJson(listProjectSessionsContract, { query: { workspaceId }, signal }),
      staleTime: VSCODE_SESSIONS_STALE_TIME,
      refetchInterval: VSCODE_MONITOR_POLL_INTERVAL,
    })),
  })
}

export function useCreateProjectSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProjectSessionBody) =>
      requestJson(createProjectSessionContract, { body }),
    onSuccess: (_result, body) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: vscodeAgentKeys.sessionList(body.workspaceId) }),
        queryClient.invalidateQueries({
          queryKey: mothershipChatKeys.workspaceLists(body.workspaceId),
        }),
      ]),
  })
}

/** Cancels this caller's wait, not a shared query or an already-dispatched native creation. */
async function waitForSelectionRequest<T>(
  signal: AbortSignal,
  operation: () => Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('创建 Sim Chat 超时或已取消，请重试以恢复同一会话。'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([operation(), cancelled])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}

/** Waits for the existing catalog projection; a selection request never republishes an old catalog. */
export async function waitForProjectedVscodeHost(
  queryClient: QueryClient,
  request: VscodeCreateChatRequest,
  signal: AbortSignal
): Promise<VscodeHost> {
  const queryKey = vscodeAgentKeys.hostList(request.workspaceId)
  const find = (data: ContractJsonResponse<typeof listVscodeHostsContract> | undefined) =>
    data?.hosts.find(
      (host) =>
        host.catalog.physicalWorkspace.id === request.catalog.physicalWorkspace.id &&
        host.catalog.physicalWorkspace.remoteAuthority ===
          request.catalog.physicalWorkspace.remoteAuthority
    )
  const data = await waitForSelectionRequest(signal, () =>
    queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal: querySignal }) =>
        requestJson(listVscodeHostsContract, {
          query: { workspaceId: request.workspaceId },
          signal: querySignal,
        }),
      staleTime: VSCODE_HOSTS_STALE_TIME,
    })
  )
  signal.throwIfAborted()
  const host = find(data)
  if (host) return host

  return new Promise((resolve, reject) => {
    const abort = () => {
      unsubscribe()
      signal.removeEventListener('abort', abort)
      reject(new Error('项目目录尚未同步到 Sim，请检查侧栏的项目同步状态后重试。'))
    }
    const check = () => {
      const projected = find(queryClient.getQueryData(queryKey))
      if (!projected) return
      unsubscribe()
      signal.removeEventListener('abort', abort)
      resolve(projected)
    }
    const unsubscribe = queryClient.getQueryCache().subscribe(check)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    else check()
  })
}

/** Both sidebar creation and the editor-selection command enter the same native operation. */
export function useCreateProjectSessionFromSelection() {
  const queryClient = useQueryClient()
  const { mutateAsync } = useCreateProjectSession()
  return useCallback(
    async (request: VscodeCreateChatRequest, signal: AbortSignal) => {
      const host = await waitForProjectedVscodeHost(queryClient, request, signal)
      signal.throwIfAborted()
      return waitForSelectionRequest(signal, () =>
        mutateAsync({
          workspaceId: request.workspaceId,
          hostId: host.id,
          projectUri: request.projectUri,
          logicalWorkspaceId: request.logicalWorkspaceId,
          requestId: request.requestId,
          selection: request.selection,
        })
      )
    },
    [queryClient, mutateAsync]
  )
}

export function useStopProjectSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: StopProjectSessionBody) => requestJson(stopProjectSessionContract, { body }),
    onSuccess: (_result, body) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: vscodeAgentKeys.sessionList(body.workspaceId) }),
        queryClient.invalidateQueries({
          queryKey: mothershipChatKeys.workspaceLists(body.workspaceId),
        }),
        queryClient.invalidateQueries({ queryKey: mothershipChatKeys.detail(body.chatId) }),
      ]),
  })
}
