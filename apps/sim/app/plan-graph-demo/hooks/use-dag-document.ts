'use client'

import { useMemo } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type DagDocument,
  getPlanFileName,
  parseDagDocument,
} from '@/app/plan-graph-demo/plan-graph-model'
import { useWorkspaceFileContent, useWorkspaceFiles } from '@/hooks/queries/workspace-files'

const PLAN_REFRESH_INTERVAL_MS = 5_000

/** Reads the canonical DAG without creating or changing a workspace file. */
export function useDagDocument(workspaceId: string | undefined, dagId: string) {
  const filesQuery = useWorkspaceFiles(workspaceId ?? '', 'active', {
    enabled: Boolean(workspaceId),
    refetchInterval: PLAN_REFRESH_INTERVAL_MS,
  })
  const file = filesQuery.data?.find(
    (candidate) =>
      candidate.workspaceId === workspaceId && candidate.name === getPlanFileName(dagId)
  )
  const contentQuery = useWorkspaceFileContent(
    workspaceId ?? '',
    file?.id ?? '',
    file?.key ?? '',
    false,
    { refetchInterval: PLAN_REFRESH_INTERVAL_MS }
  )
  const parsed = useMemo<{ dag?: DagDocument; error?: string }>(() => {
    if (!file || contentQuery.data === undefined) return {}
    try {
      const dag = parseDagDocument(contentQuery.data)
      if (dag.id !== dagId) throw new Error('The plan document has a different DAG identity')
      return { dag }
    } catch (cause) {
      return { error: getErrorMessage(cause, 'The plan document is invalid') }
    }
  }, [contentQuery.data, dagId, file])

  return {
    ...parsed,
    error: parsed.error ?? contentQuery.error?.message ?? filesQuery.error?.message,
    file,
    isMissing:
      Boolean(workspaceId) && filesQuery.isSuccess && !filesQuery.isPlaceholderData && !file,
  }
}
