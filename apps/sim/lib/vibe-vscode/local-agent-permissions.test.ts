/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deployment = vi.hoisted(() => ({ SIM_VSCODE_CODEX_SANDBOX: undefined as string | undefined }))
vi.mock('@/lib/core/config/env', () => ({ env: deployment }))

import { projectAgentPermissionPolicySchema } from '@/lib/vibe-vscode/agent-config'
import {
  getLocalAgentPermissionPolicy,
  resolveLocalAgentPermission,
} from '@/lib/vibe-vscode/local-agent-permissions'

beforeEach(() => {
  deployment.SIM_VSCODE_CODEX_SANDBOX = undefined
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
  it('fails closed if unvalidated environment input names an unrestricted sandbox', () => {
    deployment.SIM_VSCODE_CODEX_SANDBOX = 'danger-full-access'
    expect(() => resolveLocalAgentPermission('local-codex', null)).toThrow(
      expect.objectContaining({ code: 'forbidden' })
    )
    expect(getLocalAgentPermissionPolicy('local-codex').modes.map((mode) => mode.id)).toEqual([
      'read-only',
    ])
  })
})
