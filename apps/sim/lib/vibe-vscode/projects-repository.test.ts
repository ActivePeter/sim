/** @vitest-environment node */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
const mocks = vi.hoisted(() => ({ reconcile: vi.fn() }))
vi.mock('@/lib/copilot/chat/stream-liveness', () => ({
  reconcileChatStreamMarkers: mocks.reconcile,
}))

import { copilotChats, vscodeProjectSessions } from '@sim/db/schema'
import {
  createProjectSession,
  loadOwnedChat,
  syncHost,
} from '@/lib/vibe-vscode/projects-repository'
import { vscodeCatalogSchema } from '@/lib/vibe-vscode/types'

const dialect = new PgDialect()
const catalog = {
  physicalWorkspace: {
    id: 'physical-1',
    name: 'Workspace',
    remoteAuthority: 'host.test',
    folders: [
      { uri: 'vscode-remote://host.test/project-a', name: 'A', index: 0 },
      { uri: 'vscode-remote://host.test/project-b', name: 'B', index: 1 },
    ],
  },
  logicalWorkspaces: [{ id: 'logical-1', name: 'Logical workspace' }],
}
const host = {
  id: 'host-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  physicalWorkspaceId: 'physical-1',
  remoteAuthority: 'host.test',
  catalog,
  revision: 3,
  updatedAt: new Date(),
}
const input = {
  workspaceId: 'workspace-1',
  hostId: 'host-1',
  projectUri: catalog.physicalWorkspace.folders[0].uri,
  logicalWorkspaceId: 'logical-1',
  requestId: 'request-1',
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})
describe('native project session repository', () => {
  it('does not publish duplicate project identities', () => {
    expect(
      vscodeCatalogSchema.safeParse({
        ...catalog,
        physicalWorkspace: {
          ...catalog.physicalWorkspace,
          folders: [catalog.physicalWorkspace.folders[0], catalog.physicalWorkspace.folders[0]],
        },
      }).success
    ).toBe(false)
  })
  it('rejects an obsolete catalog revision without overwriting the winner', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([host])
    await expect(
      syncHost('user-1', 'workspace-1', { ...catalog, logicalWorkspaces: [] }, 2)
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('coalesces equal catalog projections regardless of a stale read revision', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([host])
    expect((await syncHost('user-1', 'workspace-1', catalog, 0)).revision).toBe(3)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })
  it('creates a native chat and its immutable origin in one transaction', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([host]).mockResolvedValueOnce([])
    const result = await createProjectSession('user-1', input)
    expect(dbChainMockFns.insert.mock.calls.map((call) => call[0])).toEqual([
      copilotChats,
      vscodeProjectSessions,
    ])
    expect(dbChainMockFns.values.mock.calls[0][0]).toMatchObject({
      id: result.id,
      userId: 'user-1',
      workspaceId: 'workspace-1',
      type: 'mothership',
    })
    expect(dbChainMockFns.values.mock.calls[1][0]).toMatchObject({
      chatId: result.id,
      origin: {
        project: { name: 'A', uri: input.projectUri },
        logicalWorkspace: { id: 'logical-1' },
      },
    })
  })
  it('opens the same native chat for a retried creation request', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([host]).mockResolvedValueOnce([
      {
        chat: { id: 'existing-chat', deletedAt: null },
        binding: {
          hostId: host.id,
          origin: {
            physicalWorkspace: catalog.physicalWorkspace,
            project: catalog.physicalWorkspace.folders[0],
            logicalWorkspace: catalog.logicalWorkspaces[0],
          },
        },
      },
    ])
    expect(await createProjectSession('user-1', input)).toEqual({
      id: 'existing-chat',
      workspaceId: 'workspace-1',
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('rejects a project removed since the initiating snapshot', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([host]).mockResolvedValueOnce([])
    await expect(
      createProjectSession('user-1', { ...input, projectUri: 'file:///not-in-catalog' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
  it('scopes native lookups to the real Sim owner and excludes archived chats', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(
      loadOwnedChat('user-1', '00000000-0000-4000-8000-000000000001')
    ).rejects.toMatchObject({ code: 'not_found' })
    const query = dialect.sqlToQuery(dbChainMockFns.where.mock.calls[0][0])
    expect(query.params).toEqual(['00000000-0000-4000-8000-000000000001', 'user-1'])
    expect(query.sql).toContain('"copilot_chats"."deleted_at" is null')
  })
})
