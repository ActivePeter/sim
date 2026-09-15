import { describe, expect, it } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import { visibleProjectSessions } from '@/lib/vibe-vscode/session-view'
import type { ProjectSession } from '@/lib/vibe-vscode/types'

const session: ProjectSession = {
  id: 'chat-1',
  workspaceId: 'workspace-1',
  title: 'Project agent',
  updatedAt: '2026-01-01T00:00:00.000Z',
  activeStreamId: 'turn-1',
  status: 'running',
  origin: null,
  runtime: 'sim',
}
describe('monitor projection authority', () => {
  it.each([401, 403, 404])('does not show cached sessions after access fails with %s', (status) => {
    expect(
      visibleProjectSessions({
        data: { sessions: [session] },
        error: new ApiClientError({ status, message: 'Unavailable', body: null }),
      })
    ).toEqual([])
  })
  it('shows an unknown, non-stoppable state when the refresh fails', () => {
    expect(
      visibleProjectSessions({ data: { sessions: [session] }, error: new Error('Offline') })
    ).toEqual([{ ...session, status: 'unknown', activeStreamId: null }])
    expect(session.status).toBe('running')
  })
  it('uses the verified server snapshot after reconnecting', () => {
    expect(visibleProjectSessions({ data: { sessions: [session] } })).toEqual([session])
  })
})
