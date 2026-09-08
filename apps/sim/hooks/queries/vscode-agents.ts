import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateProjectSessionBody,
  createProjectSessionContract,
  listProjectSessionsContract,
  listVscodeHostsContract,
  type StopProjectSessionBody,
  type SyncVscodeHostBody,
  stopProjectSessionContract,
  syncVscodeHostContract,
} from '@/lib/api/contracts/vscode-agents'
import { mothershipChatKeys } from '@/hooks/queries/mothership-chats'

export const VSCODE_HOSTS_STALE_TIME = 30_000
export const VSCODE_SESSIONS_STALE_TIME = 2000
export const VSCODE_MONITOR_POLL_INTERVAL = 4000
export const vscodeAgentKeys = {
  all: ['vscode-agents'] as const,
  hosts: () => [...vscodeAgentKeys.all, 'hosts'] as const,
  hostList: (workspaceId: string) => [...vscodeAgentKeys.hosts(), workspaceId] as const,
  sessions: () => [...vscodeAgentKeys.all, 'sessions'] as const,
  sessionList: (workspaceId: string) => [...vscodeAgentKeys.sessions(), workspaceId] as const,
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
