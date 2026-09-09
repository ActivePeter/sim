/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deployment = vi.hoisted(() => ({
  SIM_VSCODE_CODEX_SANDBOX: undefined as string | undefined,
  SIM_VSCODE_ALLOW_UNRESTRICTED: undefined as string | undefined,
}))
vi.mock('@/lib/core/config/env', () => ({ env: deployment }))

import { projectAgentPermissionPolicySchema } from '@/lib/vibe-vscode/agent-config'
import {
  getLocalAgentPermissionPolicy,
  resolveLocalAgentPermission,
} from '@/lib/vibe-vscode/local-agent-permissions'

beforeEach(() => {
  deployment.SIM_VSCODE_CODEX_SANDBOX = undefined
  deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = undefined
})

describe('local Agent permission authority', () => {
  it('defaults to read-only and never advertises or grants an unconfigured write mode', () => {
    const policy = getLocalAgentPermissionPolicy('local-codex')
    expect(projectAgentPermissionPolicySchema.parse(policy)).toEqual(policy)
    expect({
      defaultMode: policy.defaultMode,
      choices: policy.modes.map((mode) => mode.id),
    }).toEqual({
      defaultMode: 'read-only',
      choices: ['read-only'],
    })
    expect(resolveLocalAgentPermission('local-codex', null)).toBe('read-only')
    expect(() => resolveLocalAgentPermission('local-codex', 'workspace-write')).toThrow(
      expect.objectContaining({ code: 'forbidden' })
    )
  })
  it('lets a session narrow the configured ceiling without changing the deployment default', () => {
    deployment.SIM_VSCODE_CODEX_SANDBOX = 'workspace-write'
    const policy = getLocalAgentPermissionPolicy('local-codex')
    expect(projectAgentPermissionPolicySchema.parse(policy)).toEqual(policy)
    expect(policy.modes.map((mode) => mode.id)).toEqual(['read-only', 'workspace-write'])
    expect([
      resolveLocalAgentPermission('local-codex', 'read-only'),
      resolveLocalAgentPermission('local-codex', 'workspace-write'),
      resolveLocalAgentPermission('local-codex', null),
    ]).toEqual(['read-only', 'workspace-write', 'workspace-write'])
    deployment.SIM_VSCODE_CODEX_SANDBOX = 'read-only'
    expect(() => resolveLocalAgentPermission('local-codex', 'workspace-write')).toThrow(
      expect.objectContaining({ code: 'forbidden' })
    )
  })
  it('does not inherit Codex permissions into the Claude read-tool adapter', () => {
    deployment.SIM_VSCODE_CODEX_SANDBOX = 'workspace-write'
    const policy = getLocalAgentPermissionPolicy('local-claude')
    expect(projectAgentPermissionPolicySchema.parse(policy)).toEqual(policy)
    expect(policy.modes.map((mode) => mode.id)).toEqual(['read-only'])
    expect(resolveLocalAgentPermission('local-claude', null)).toBe('read-only')
    expect(() => resolveLocalAgentPermission('local-claude', 'workspace-write')).toThrow(
      expect.objectContaining({ code: 'forbidden' })
    )
  })
  it.each([undefined, 'false', 'TRUE', '1', 'yes', 'true ', ''])(
    'requires an exact deployment opt-in for either runtime: %s',
    (allowUnrestricted) => {
      deployment.SIM_VSCODE_CODEX_SANDBOX = 'workspace-write'
      deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = allowUnrestricted
      for (const agentId of ['local-codex', 'local-claude'] as const) {
        expect(getLocalAgentPermissionPolicy(agentId).modes.map((mode) => mode.id)).not.toContain(
          'danger-full-access'
        )
        expect(() => resolveLocalAgentPermission(agentId, 'danger-full-access')).toThrow(
          expect.objectContaining({ code: 'forbidden' })
        )
      }
    }
  )
  it.each([undefined, 'read-only', 'workspace-write'])(
    'permits an explicit unrestricted choice without widening defaults or saved restrictions: %s',
    (defaultMode) => {
      deployment.SIM_VSCODE_CODEX_SANDBOX = defaultMode
      deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = 'true'
      for (const agentId of ['local-codex', 'local-claude'] as const) {
        const policy = getLocalAgentPermissionPolicy(agentId)
        expect(projectAgentPermissionPolicySchema.parse(policy)).toEqual(policy)
        expect({
          defaultMode: policy.defaultMode,
          choices: policy.modes.map((mode) => mode.id),
          inherited: resolveLocalAgentPermission(agentId, null),
          omitted: resolveLocalAgentPermission(agentId, undefined),
          readOnly: resolveLocalAgentPermission(agentId, 'read-only'),
          unrestricted: resolveLocalAgentPermission(agentId, 'danger-full-access'),
        }).toEqual({
          defaultMode: agentId === 'local-codex' ? (defaultMode ?? 'read-only') : 'read-only',
          choices:
            agentId === 'local-codex'
              ? ['read-only', 'workspace-write', 'danger-full-access']
              : ['read-only', 'danger-full-access'],
          inherited: agentId === 'local-codex' ? (defaultMode ?? 'read-only') : 'read-only',
          omitted: agentId === 'local-codex' ? (defaultMode ?? 'read-only') : 'read-only',
          readOnly: 'read-only',
          unrestricted: 'danger-full-access',
        })
      }
      expect(resolveLocalAgentPermission('local-codex', 'workspace-write')).toBe('workspace-write')
      expect(() => resolveLocalAgentPermission('local-claude', 'workspace-write')).toThrow(
        expect.objectContaining({ code: 'forbidden' })
      )
    }
  )
  it('revokes a saved unrestricted choice when the deployment withdraws permission', () => {
    deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = 'true'
    expect(resolveLocalAgentPermission('local-codex', 'danger-full-access')).toBe(
      'danger-full-access'
    )
    deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = 'false'
    for (const agentId of ['local-codex', 'local-claude'] as const) {
      expect(() => resolveLocalAgentPermission(agentId, 'danger-full-access')).toThrow(
        expect.objectContaining({ code: 'forbidden' })
      )
    }
  })
  it.each(['danger-full-access', 'bypassPermissions', 'invalid', ''])(
    'fails closed on an invalid deployment default even with unrestricted enabled: %s',
    (defaultMode) => {
      deployment.SIM_VSCODE_CODEX_SANDBOX = defaultMode
      for (const optIn of [undefined, 'true']) {
        deployment.SIM_VSCODE_ALLOW_UNRESTRICTED = optIn
        expect(() => getLocalAgentPermissionPolicy('local-codex')).toThrow(
          expect.objectContaining({ code: 'forbidden' })
        )
        for (const mode of [null, 'read-only', 'danger-full-access'] as const) {
          expect(() => resolveLocalAgentPermission('local-codex', mode)).toThrow(
            expect.objectContaining({ code: 'forbidden' })
          )
        }
      }
    }
  )
})
