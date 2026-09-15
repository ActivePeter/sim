/** @vitest-environment node */
import { authMock, authMockFns, createEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  workspace: vi.fn(),
  chat: vi.fn(),
  update: vi.fn(),
  capabilities: vi.fn(),
  validate: vi.fn(),
}))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/core/config/env', () =>
  createEnvMock({
    VIBE_VSCODE_AGENT_GATEWAY_SECRET: 'test-gateway-secret-not-a-credential-0123456789',
  })
)
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: mocks.permission,
  permissionSatisfies: (actual: string, required: string) =>
    actual === 'admin' || actual === required || (actual === 'write' && required === 'read'),
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/vibe-vscode/projects-repository', () => ({
  loadOwnedChat: mocks.chat,
  updateProjectAgentConfig: mocks.update,
}))
vi.mock('@/lib/vibe-vscode/local-agents', () => ({
  getProjectAgentCapabilities: mocks.capabilities,
  validateProjectAgentSettings: mocks.validate,
}))
vi.mock('@/lib/copilot/request/session', () => ({
  abortActiveStream: vi.fn(),
  getPendingChatStreamId: vi.fn(),
}))
vi.mock('@/lib/copilot/chat-status', () => ({ chatPubSub: null }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { DEFAULT_PROJECT_AGENT_CONFIG } from '@/lib/vibe-vscode/agent-config'
import {
  getProjectAgentConfig,
  updateProjectAgentConfig,
} from '@/lib/vibe-vscode/application/agent-config'
import { GET, PATCH } from '@/app/api/vscode/sessions/[chatId]/config/route'

const principal = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const chatId = '00000000-0000-4000-8000-000000000001'
const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG
const input = { chatId, workspaceId: 'workspace-1', expectedRevision: 0, settings }
const capabilities = [
  {
    id: 'local-codex',
    label: 'Codex',
    available: true,
    permissions: {
      defaultMode: 'read-only',
      description: 'Test deployment permits only reading',
      modes: [{ id: 'read-only', label: 'Read only', description: 'Read-only sandbox' }],
    },
    modelCatalog: {
      status: 'ready',
      models: [
        {
          id: 'test-model',
          label: 'Test model',
          description: '',
          reasoningEfforts: ['low', 'high'],
          defaultReasoningEffort: 'low',
        },
      ],
    },
  },
]
const state = { config: DEFAULT_PROJECT_AGENT_CONFIG, agentLocked: false }
const routeContext = { params: Promise.resolve({ chatId }) }
function request(method = 'GET', body?: unknown, gateway = true) {
  return new NextRequest(
    `https://vscode.example.test/api/vscode/sessions/${chatId}/config?workspaceId=workspace-1`,
    {
      method,
      headers: {
        ...(gateway
          ? { 'x-vibe-agent-gateway': 'test-gateway-secret-not-a-credential-0123456789' }
          : {}),
        origin: 'https://vscode.example.test',
        'content-type': 'application/json',
      },
      ...(body !== undefined
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    }
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.permission.mockResolvedValue('write')
  mocks.workspace.mockResolvedValue({
    workspaceId: 'workspace-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: false,
    billedAccountUserId: 'billing-is-not-actor',
  })
  mocks.chat.mockResolvedValue({
    chat: { id: chatId, workspaceId: 'workspace-1' },
    binding: { agentConfig: null, lastTurnId: null, runtimeThreadId: null },
  })
  mocks.capabilities.mockResolvedValue(capabilities)
  mocks.validate.mockImplementation(async (value) => value)
  mocks.update.mockResolvedValue(state)
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'user-1' },
    session: { id: 'session-1' },
  })
})

describe('project Agent config application authority', () => {
  it('permits an owned read after current workspace authorization', async () => {
    mocks.permission.mockResolvedValue('read')
    expect(await getProjectAgentConfig.execute({ principal, input })).toEqual({
      ...state,
      agents: capabilities,
    })
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.capabilities.mock.invocationCallOrder[0]
    )
  })
  it('writes with the actual session owner and canonical workspace, never billing attribution', async () => {
    expect(await updateProjectAgentConfig.execute({ principal, input })).toEqual(state)
    expect(mocks.update).toHaveBeenCalledWith('user-1', input)
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.validate.mock.invocationCallOrder[0]
    )
  })
  it('denies a readonly member before validating or updating runtime settings', async () => {
    mocks.permission.mockResolvedValue('read')
    await expect(updateProjectAgentConfig.execute({ principal, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('denies workspace keys before a protected lookup', async () => {
    await expect(
      getProjectAgentConfig.execute({
        principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-1' },
        input,
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it('conceals an asserted-workspace mismatch', async () => {
    await expect(
      updateProjectAgentConfig.execute({
        principal,
        input: { ...input, workspaceId: 'another-workspace' },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('never reinterprets an unbound cloud session as a local Agent', async () => {
    mocks.chat.mockResolvedValue({
      chat: { id: chatId, workspaceId: 'workspace-1' },
      binding: null,
    })
    await expect(getProjectAgentConfig.execute({ principal, input })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(mocks.capabilities).not.toHaveBeenCalled()
  })
  it('propagates infrastructure failure instead of reporting an empty configuration', async () => {
    const error = new Error('database unavailable')
    mocks.chat.mockRejectedValue(error)
    await expect(getProjectAgentConfig.execute({ principal, input })).rejects.toBe(error)
    expect(mocks.capabilities).not.toHaveBeenCalled()
  })
})

describe('project Agent config internal routes', () => {
  it('enforces the main gateway and Sim session before parsing malformed input', async () => {
    expect((await PATCH(request('PATCH', '{', false), routeContext)).status).toBe(403)
    expect(authMockFns.mockGetSession).not.toHaveBeenCalled()
    authMockFns.mockGetSession.mockResolvedValue(null)
    expect((await PATCH(request('PATCH', '{'), routeContext)).status).toBe(401)
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it('projects only the typed public runtime configuration', async () => {
    const response = await GET(request(), routeContext)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...state, agents: capabilities })
  })
  it('uses the same semantic update and rejects process flags at the contract', async () => {
    const body = { workspaceId: input.workspaceId, expectedRevision: 0, settings }
    expect(
      (
        await PATCH(
          request('PATCH', { ...body, settings: { ...settings, sandbox: 'unrestricted' } }),
          routeContext
        )
      ).status
    ).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
    const response = await PATCH(request('PATCH', body), routeContext)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(state)
    expect(mocks.update).toHaveBeenCalledWith('user-1', input)
  })
  it('keeps conflict errors visible and conceals infrastructure details', async () => {
    const body = { workspaceId: input.workspaceId, expectedRevision: 0, settings }
    mocks.update.mockRejectedValueOnce(new OrchestrationError('conflict', 'Configuration changed'))
    const conflict = await PATCH(request('PATCH', body), routeContext)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: 'Configuration changed' })
    mocks.update.mockRejectedValueOnce(new Error('private database details'))
    const failure = await PATCH(request('PATCH', body), routeContext)
    expect(failure.status).toBe(500)
    expect(JSON.stringify(await failure.json())).not.toContain('private database')
  })
  it('does not let a stale client omit permission intent and reset a saved restriction', async () => {
    const { permissionMode: _permission, ...legacySettings } = settings
    const response = await PATCH(
      request('PATCH', {
        workspaceId: input.workspaceId,
        expectedRevision: 0,
        settings: legacySettings,
      }),
      routeContext
    )
    expect(response.status).toBe(400)
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('preserves a deployment permission denial without persisting the requested escalation', async () => {
    mocks.validate.mockRejectedValue(
      new OrchestrationError('forbidden', 'Deployment forbids writing')
    )
    const response = await PATCH(
      request('PATCH', {
        workspaceId: input.workspaceId,
        expectedRevision: 0,
        settings: { ...settings, permissionMode: 'workspace-write' },
      }),
      routeContext
    )
    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
