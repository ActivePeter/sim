/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  workspace: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  hosts: vi.fn(),
  sync: vi.fn(),
  chat: vi.fn(),
  pending: vi.fn(),
  abort: vi.fn(),
  publish: vi.fn(),
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/vibe-vscode/projects-repository', () => ({
  createProjectSession: mocks.create,
  listProjectSessions: mocks.list,
  listHosts: mocks.hosts,
  syncHost: mocks.sync,
  loadOwnedChat: mocks.chat,
}))
vi.mock('@/lib/copilot/request/session', () => ({
  abortActiveStream: mocks.abort,
  getPendingChatStreamId: mocks.pending,
}))
vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: { publishStatusChanged: mocks.publish },
}))

import {
  createProjectSession,
  listProjectSessions,
  resolveProjectChatRuntime,
  stopProjectSession,
} from '@/lib/vibe-vscode/application/projects'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const input = {
  workspaceId: 'workspace-1',
  hostId: 'host-1',
  projectUri: 'file:///project-a',
  requestId: 'request-1',
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue('write')
  mocks.workspace.mockResolvedValue({
    workspaceId: 'workspace-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: false,
    billedAccountUserId: 'user-1',
  })
  mocks.create.mockResolvedValue({ id: 'chat-1', workspaceId: 'workspace-1' })
  mocks.chat.mockResolvedValue({
    chat: { id: 'chat-1', workspaceId: 'workspace-1' },
    binding: { origin: {} },
  })
  mocks.pending.mockResolvedValue('turn-2')
})
describe('project session application authority', () => {
  it('uses the authenticated Sim owner, not a user identity supplied by VS Code', async () => {
    await createProjectSession.execute({ principal, input })
    expect(mocks.create).toHaveBeenCalledWith('user-1', input)
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]
    )
    expect(mocks.publish).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      type: 'created',
    })
  })
  it('denies readonly workspace members before creating a chat or publishing', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(createProjectSession.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('rejects workspace API keys before any canonical lookup', async () => {
    await expect(
      createProjectSession.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('does not present a session from a different asserted workspace', async () => {
    await expect(
      resolveProjectChatRuntime.execute({
        principal,
        input: { chatId: 'chat-1', workspaceId: 'workspace-2' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('cannot stop a newer turn using an old monitor snapshot', async () => {
    await expect(
      stopProjectSession.execute({ principal, input: { chatId: 'chat-1', streamId: 'turn-1' } })
    ).resolves.toEqual({ stopped: false })
    expect(mocks.abort).not.toHaveBeenCalled()
    await expect(
      stopProjectSession.execute({ principal, input: { chatId: 'chat-1', streamId: 'turn-2' } })
    ).resolves.toEqual({ stopped: true })
    expect(mocks.abort).toHaveBeenCalledWith('turn-2')
  })
  it('rechecks revoked access before reading monitor data', async () => {
    mocks.permission.mockResolvedValue(null)
    await expect(
      listProjectSessions.execute({ principal, input: { workspaceId: 'workspace-1' } })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
