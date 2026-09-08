'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import type { DagResponse } from '@/lib/api/contracts/dags'
import type { DagDocument } from '@/lib/dags/model'
import { dagKeys, useDag, useUpdateDag } from '@/hooks/queries/dags'

export type DagMutation = (document: DagDocument) => DagDocument
interface PendingEdit {
  scope: string
  document: DagDocument
  count: number
}

/** React Query owns durable data; this hook owns only the editor's uncommitted FIFO and draft. */
export function usePersistedDag(workspaceId: string, dagId: string) {
  const queryClient = useQueryClient()
  const query = useDag(workspaceId, dagId)
  const { mutateAsync: saveDag } = useUpdateDag()
  const scope = JSON.stringify([workspaceId, dagId])
  const [pendingEdit, setPendingEdit] = useState<PendingEdit>()
  const [writeError, setWriteError] = useState<{ scope: string; message: string }>()
  const pendingRef = useRef<PendingEdit | undefined>(undefined)
  const tailRef = useRef<Promise<void>>(Promise.resolve())
  const generationRef = useRef(0)

  useEffect(
    () => () => {
      generationRef.current += 1
      pendingRef.current = undefined
    },
    [scope]
  )

  const updateDag = useCallback(
    (mutation: DagMutation): boolean => {
      if (query.isError || !workspaceId) return false
      const pending = pendingRef.current?.scope === scope ? pendingRef.current : undefined
      const current =
        pending?.document ??
        queryClient.getQueryData<DagResponse>(dagKeys.detail(workspaceId, dagId))?.dag
      if (!current) return false
      const next = mutation(current)
      if (next === current) return false
      const edit = { scope, document: next, count: (pending?.count ?? 0) + 1 }
      pendingRef.current = edit
      setPendingEdit(edit)
      setWriteError(undefined)
      const generation = generationRef.current
      const save = tailRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== generationRef.current) return
          await saveDag({ workspaceId, dagId, document: next, expectedRevision: current.revision })
          if (generation !== generationRef.current) return
          const latest = pendingRef.current
          const remaining =
            latest && latest.count > 1 ? { ...latest, count: latest.count - 1 } : undefined
          pendingRef.current = remaining
          setPendingEdit(remaining)
        })
        .catch((cause: unknown) => {
          if (generation !== generationRef.current) return
          generationRef.current += 1
          pendingRef.current = undefined
          setPendingEdit(undefined)
          const message = getErrorMessage(cause, 'Failed to save the DAG')
          setWriteError({ scope, message })
          toast.error(message)
          void queryClient.invalidateQueries({ queryKey: dagKeys.detail(workspaceId, dagId) })
        })
      tailRef.current = save
      return true
    },
    [dagId, query.isError, queryClient, saveDag, scope, workspaceId]
  )

  const isMissing = query.error instanceof ApiClientError && query.error.status === 404
  const isInaccessible =
    query.error instanceof ApiClientError && [401, 403, 404].includes(query.error.status)
  const persistedDag = isInaccessible ? undefined : query.data?.dag
  return {
    dag: isInaccessible
      ? undefined
      : pendingEdit?.scope === scope
        ? pendingEdit.document
        : persistedDag,
    persistedDag,
    error: writeError?.scope === scope ? writeError.message : query.error?.message,
    isLoading: query.isPending && Boolean(workspaceId),
    isMissing,
    isSaving: Boolean(pendingEdit?.scope === scope && pendingEdit.count > 0),
    updateDag,
  }
}
