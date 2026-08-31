'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  createDemoDag,
  type DagDocument,
  getPlanFileName,
  parseDagDocument,
  serializeDagDocument,
} from '@/app/plan-graph-demo/plan-graph-model'
import {
  useCreateWorkspaceFile,
  useUpdateWorkspaceFileContent,
  useWorkspaceFileContent,
  useWorkspaceFiles,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'

const PLAN_REFRESH_INTERVAL_MS = 5_000

export type DagMutation = (document: DagDocument) => DagDocument

interface UsePersistedDagResult {
  dag?: DagDocument
  error?: string
  fileId?: string
  isLoading: boolean
  isSaving: boolean
  reset: () => void
  updateDag: (mutation: DagMutation) => boolean
}

function contentVersion(file: WorkspaceFileRecord | undefined): string | undefined {
  return (file?.contentUpdatedAt ?? file?.updatedAt)?.toISOString()
}

/** Persists a DAG in one workspace file and serializes local writes behind its content CAS token. */
export function usePersistedDag(
  workspaceId: string | undefined,
  dagId: string
): UsePersistedDagResult {
  const queryClient = useQueryClient()
  const { mutate: createWorkspaceFile } = useCreateWorkspaceFile()
  const { mutateAsync: updateWorkspaceFileContent } = useUpdateWorkspaceFileContent()
  const [dag, setDag] = useState<DagDocument | undefined>(() =>
    workspaceId ? undefined : createDemoDag(dagId)
  )
  const [error, setError] = useState<string>()
  const [pendingWrites, setPendingWrites] = useState(0)
  const creatingRef = useRef(false)
  const optimisticRef = useRef<DagDocument | undefined>(dag)
  const persistedRef = useRef<DagDocument | undefined>(dag)
  const fileRef = useRef<WorkspaceFileRecord | undefined>(undefined)
  const saveTailRef = useRef<Promise<void>>(Promise.resolve())
  const saveGenerationRef = useRef(0)

  const planFileName = getPlanFileName(dagId)
  const filesQuery = useWorkspaceFiles(workspaceId ?? '', 'active', {
    enabled: Boolean(workspaceId),
    refetchInterval: PLAN_REFRESH_INTERVAL_MS,
  })
  const planFile = filesQuery.data?.find((file) => file.name === planFileName)
  const contentQuery = useWorkspaceFileContent(
    workspaceId ?? '',
    planFile?.id ?? '',
    planFile?.key ?? '',
    false,
    { refetchInterval: PLAN_REFRESH_INTERVAL_MS }
  )

  useEffect(() => {
    if (!planFile) return
    const currentVersion = contentVersion(fileRef.current)
    const nextVersion = contentVersion(planFile)
    if (!currentVersion || !nextVersion || nextVersion >= currentVersion) fileRef.current = planFile
  }, [planFile])

  useEffect(() => {
    if (!workspaceId || filesQuery.isLoading || planFile || creatingRef.current) return
    creatingRef.current = true
    const initial = createDemoDag(dagId)
    createWorkspaceFile(
      {
        workspaceId,
        name: planFileName,
        contentType: 'application/json',
        content: serializeDagDocument(initial),
        encoding: 'utf-8',
      },
      {
        onError: (cause) => {
          creatingRef.current = false
          setError(getErrorMessage(cause, 'Failed to create the plan document'))
        },
      }
    )
  }, [createWorkspaceFile, dagId, filesQuery.isLoading, planFile, planFileName, workspaceId])

  useEffect(() => {
    if (!contentQuery.data || pendingWrites > 0) return
    try {
      const parsed = parseDagDocument(contentQuery.data)
      const currentRevision = persistedRef.current?.revision ?? -1
      if (parsed.revision >= currentRevision) {
        persistedRef.current = parsed
        optimisticRef.current = parsed
        setDag(parsed)
      }
      setError(undefined)
    } catch (cause) {
      setError(getErrorMessage(cause, 'The plan document is invalid'))
    }
  }, [contentQuery.data, pendingWrites])

  const recoverFromWriteFailure = useCallback(
    (cause: unknown, generation: number) => {
      if (generation !== saveGenerationRef.current) return
      saveGenerationRef.current += 1
      const persisted = persistedRef.current
      optimisticRef.current = persisted
      setDag(persisted)
      setPendingWrites(0)
      const message = getErrorMessage(cause, 'Failed to save the plan document')
      setError(message)
      toast.error(`${message}. Reloaded the latest durable revision.`)
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: workspaceFilesKeys.workspaceLists(workspaceId),
        })
      }
    },
    [queryClient, workspaceId]
  )

  const updateDag = useCallback(
    (mutation: DagMutation): boolean => {
      const current = optimisticRef.current
      if (!current) return false
      const next = mutation(current)
      if (next === current) return false

      optimisticRef.current = next
      setDag(next)
      if (!workspaceId) {
        persistedRef.current = next
        return true
      }

      const generation = saveGenerationRef.current
      setPendingWrites((count) => count + 1)
      const save = saveTailRef.current
        .catch(() => undefined)
        .then(async () => {
          if (generation !== saveGenerationRef.current) return
          const file = fileRef.current
          const expectedContentUpdatedAt = contentVersion(file)
          if (!file || !expectedContentUpdatedAt) {
            throw new Error('Plan file content version is not available')
          }
          const response = await updateWorkspaceFileContent({
            workspaceId,
            fileId: file.id,
            content: serializeDagDocument(next),
            encoding: 'utf-8',
            expectedContentUpdatedAt,
          })
          if (generation !== saveGenerationRef.current) return
          fileRef.current = response.file
          persistedRef.current = next
          setPendingWrites((count) => Math.max(0, count - 1))
          setError(undefined)
        })
      saveTailRef.current = save
      void save.catch((cause) => recoverFromWriteFailure(cause, generation))
      return true
    },
    [recoverFromWriteFailure, updateWorkspaceFileContent, workspaceId]
  )

  const reset = useCallback(() => {
    updateDag((current) => ({ ...createDemoDag(dagId), revision: current.revision + 1 }))
  }, [dagId, updateDag])

  return {
    dag,
    error,
    fileId: planFile?.id,
    isLoading: Boolean(workspaceId) && (!dag || filesQuery.isLoading || contentQuery.isLoading),
    isSaving: pendingWrites > 0,
    reset,
    updateDag,
  }
}
