import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateDagBody,
  createDagContract,
  type DagResponse,
  listDagsContract,
  readDagContract,
  type UpdateDagBody,
  updateDagContract,
} from '@/lib/api/contracts/dags'

export const dagKeys = {
  all: ['dags'] as const,
  lists: () => [...dagKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...dagKeys.lists(), workspaceId] as const,
  details: () => [...dagKeys.all, 'detail'] as const,
  detail: (workspaceId: string, dagId: string) =>
    [...dagKeys.details(), workspaceId, dagId] as const,
}
export const DAG_STALE_TIME = 5_000

function retryDagRead(count: number, error: Error) {
  return (
    !(error instanceof ApiClientError && error.status >= 400 && error.status < 500) && count < 2
  )
}

export function useDags(workspaceId: string) {
  return useQuery({
    queryKey: dagKeys.list(workspaceId),
    queryFn: ({ signal }) => requestJson(listDagsContract, { params: { id: workspaceId }, signal }),
    enabled: Boolean(workspaceId),
    staleTime: DAG_STALE_TIME,
    refetchInterval: DAG_STALE_TIME,
    retry: retryDagRead,
  })
}

export function useDag(workspaceId: string, dagId: string) {
  return useQuery({
    queryKey: dagKeys.detail(workspaceId, dagId),
    queryFn: async ({ signal }) => {
      const result = await requestJson(readDagContract, {
        params: { id: workspaceId, dagId },
        signal,
      })
      if (result.dag.id !== dagId)
        throw new Error('DAG response identity does not match the requested document')
      return result
    },
    enabled: Boolean(workspaceId && dagId),
    staleTime: DAG_STALE_TIME,
    refetchInterval: DAG_STALE_TIME,
    retry: retryDagRead,
  })
}

export function useCreateDag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workspaceId, ...body }: CreateDagBody & { workspaceId: string }) =>
      requestJson(createDagContract, { params: { id: workspaceId }, body }),
    onSuccess: (data, input) => {
      queryClient.setQueryData(dagKeys.detail(input.workspaceId, data.dag.id), data)
      void queryClient.invalidateQueries({ queryKey: dagKeys.list(input.workspaceId) })
    },
  })
}

export function useUpdateDag() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      workspaceId,
      dagId,
      ...body
    }: UpdateDagBody & { workspaceId: string; dagId: string }) =>
      requestJson(updateDagContract, { params: { id: workspaceId, dagId }, body }),
    onMutate: (input) =>
      queryClient.cancelQueries({ queryKey: dagKeys.detail(input.workspaceId, input.dagId) }),
    onSuccess: async (data, input) => {
      await queryClient.cancelQueries({ queryKey: dagKeys.detail(input.workspaceId, input.dagId) })
      queryClient.setQueryData<DagResponse>(
        dagKeys.detail(input.workspaceId, input.dagId),
        (current) => (current && current.dag.revision > data.dag.revision ? current : data)
      )
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: dagKeys.list(input.workspaceId) })
      void queryClient.invalidateQueries({
        queryKey: dagKeys.detail(input.workspaceId, input.dagId),
      })
    },
  })
}
