import { isApiClientError } from '@/lib/api/client/errors'
import type { ProjectSession } from '@/lib/vibe-vscode/types'

export function isSessionAccessDenied(error: unknown): boolean {
  return isApiClientError(error) && [401, 403, 404].includes(error.status)
}

/** Cached data is not permission or liveness authority after a failed refresh. */
export function visibleProjectSessions(query: {
  data?: { sessions: ProjectSession[] }
  error?: unknown
}): ProjectSession[] {
  if (isSessionAccessDenied(query.error)) return []
  const sessions = query.data?.sessions ?? []
  return query.error
    ? sessions.map((session) => ({ ...session, status: 'unknown', activeStreamId: null }))
    : sessions
}
