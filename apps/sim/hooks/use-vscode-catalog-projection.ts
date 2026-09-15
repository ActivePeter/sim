import { useCallback, useEffect } from 'react'
import { isApiClientError } from '@/lib/api/client/errors'
import type { VibeVscodeHostContext, VscodeHost } from '@/lib/api/contracts/vscode-agents'
import { vscodeCatalogFingerprint } from '@/lib/vibe-vscode/types'
import { useSyncVscodeHost } from '@/hooks/queries/vscode-agents'

interface UseVscodeCatalogProjectionProps {
  workspaceId: string
  context?: VibeVscodeHostContext
  hosts?: VscodeHost[]
}

export function useVscodeCatalogProjection({
  workspaceId,
  context,
  hosts,
}: UseVscodeCatalogProjectionProps) {
  const { mutateAsync, error, isPending } = useSyncVscodeHost()
  const catalog =
    context?.physicalWorkspace && context.logicalWorkspaces
      ? {
          physicalWorkspace: context.physicalWorkspace,
          logicalWorkspaces: context.logicalWorkspaces,
        }
      : undefined
  const host = hosts?.find(
    (item) =>
      item.catalog.physicalWorkspace.id === catalog?.physicalWorkspace.id &&
      item.catalog.physicalWorkspace.remoteAuthority === catalog?.physicalWorkspace.remoteAuthority
  )
  const serialized = catalog ? JSON.stringify(catalog) : undefined
  const fingerprint = catalog ? vscodeCatalogFingerprint(catalog) : undefined
  const stored = host ? vscodeCatalogFingerprint(host.catalog) : undefined
  const revision = host?.revision ?? 0

  useEffect(() => {
    if (!serialized || fingerprint === stored || !hosts) return
    const controller = new AbortController()
    void mutateAsync({
      body: { workspaceId, catalog: JSON.parse(serialized), expectedRevision: revision },
      signal: controller.signal,
    }).catch(() => {
      // The mutation exposes errors and refreshes the canonical revision. An obsolete request
      // cannot retry with a newer revision after its initiating context has been replaced.
    })
    return () => controller.abort()
  }, [workspaceId, serialized, fingerprint, stored, revision, hosts, mutateAsync])

  const retry = useCallback(() => {
    if (!serialized) return
    void mutateAsync({
      body: { workspaceId, catalog: JSON.parse(serialized), expectedRevision: revision },
    }).catch(() => {})
  }, [workspaceId, serialized, revision, mutateAsync])

  return {
    host,
    isSyncing: !!catalog && (isPending || fingerprint !== stored),
    retry,
    error: isApiClientError(error) && error.status === 409 ? null : error,
  }
}
