/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROJECT_AGENT_CONFIG,
  getProjectAgentModel,
  isProjectAgentLocked,
  projectAgentPermissionPolicySchema,
  projectAgentSettingsSchema,
  readProjectAgentConfig,
} from '@/lib/vibe-vscode/agent-config'

describe('project Agent configuration authority', () => {
  it('keeps unconfigured legacy chats on Codex', () => {
    expect(readProjectAgentConfig(null)).toEqual(DEFAULT_PROJECT_AGENT_CONFIG)
    expect(Object.isFrozen(readProjectAgentConfig(undefined))).toBe(true)
  })
  it.each([
    { version: 2 },
    { ...DEFAULT_PROJECT_AGENT_CONFIG, agentId: 'not-an-agent' },
    'bad data',
  ])('does not treat broken stored configuration as a new default: %j', (value) => {
    expect(() => readProjectAgentConfig(value)).toThrow(
      expect.objectContaining({ code: 'conflict' })
    )
  })
  it('takes an immutable copy of database values', () => {
    const stored = { ...DEFAULT_PROJECT_AGENT_CONFIG, model: 'model-one' }
    const captured = readProjectAgentConfig(stored)
    stored.model = 'model-two'
    expect(captured.model).toBe('model-one')
    expect(Object.isFrozen(captured)).toBe(true)
  })
  it('reads legacy permissions as deployment defaults but requires explicit permission intent on writes', () => {
    const { permissionMode: _permission, ...legacy } = DEFAULT_PROJECT_AGENT_CONFIG
    expect(readProjectAgentConfig(legacy)).toEqual(DEFAULT_PROJECT_AGENT_CONFIG)
    const { version: _version, revision: _revision, ...legacySettings } = legacy
    expect(projectAgentSettingsSchema.safeParse(legacySettings).success).toBe(false)
    expect(readProjectAgentConfig({ ...legacy, permissionMode: 'read-only' }).permissionMode).toBe(
      'read-only'
    )
  })
  it('round-trips an explicit unrestricted choice without making it a deployment default', () => {
    const stored = {
      ...DEFAULT_PROJECT_AGENT_CONFIG,
      permissionMode: 'danger-full-access',
      revision: 2,
    }
    const { version: _version, revision: _revision, ...settings } = stored
    expect(projectAgentSettingsSchema.parse(settings)).toEqual(settings)
    expect(readProjectAgentConfig(stored)).toEqual(stored)
    expect(
      projectAgentPermissionPolicySchema.safeParse({
        defaultMode: 'danger-full-access',
        description: 'Invalid deployment default',
        modes: [{ id: 'danger-full-access', label: '不限制', description: 'Unrestricted' }],
      }).success
    ).toBe(false)
  })
  it.each(['bypassPermissions', '--full-auto', '--dangerously-skip-permissions', ''])(
    'rejects runner flags and unknown permission modes: %s',
    (permissionMode) => {
      const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG
      expect(projectAgentSettingsSchema.safeParse({ ...settings, permissionMode }).success).toBe(
        false
      )
    }
  )
  it.each(['--dangerously-skip-permissions', 'model\n-c evil=true', 'model;$(command)', ''])(
    'rejects flag-like or malformed model identifiers: %s',
    (model) => {
      const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG
      expect(projectAgentSettingsSchema.safeParse({ ...settings, model }).success).toBe(false)
    }
  )
  it('does not accept executables, credentials or arbitrary permission flags', () => {
    const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG
    for (const field of ['cwd', 'executable', 'env', 'approvalPolicy', 'sandbox']) {
      expect(
        projectAgentSettingsSchema.safeParse({ ...settings, [field]: 'untrusted' }).success
      ).toBe(false)
    }
  })
  it('locks a runtime at first durable turn admission, before a process returns a thread ID', () => {
    expect(isProjectAgentLocked({ lastTurnId: null, runtimeThreadId: null })).toBe(false)
    expect(isProjectAgentLocked({ lastTurnId: 'turn', runtimeThreadId: null })).toBe(true)
    expect(isProjectAgentLocked({ lastTurnId: null, runtimeThreadId: 'legacy-thread' })).toBe(true)
  })
  it.each(['ultra', 'minimal', 'future-level'])(
    'accepts bounded runtime-provided effort identifiers without a hardcoded level union: %s',
    (reasoningEffort) => {
      const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG
      expect(projectAgentSettingsSchema.safeParse({ ...settings, reasoningEffort }).success).toBe(
        true
      )
    }
  )
  it.each(['--unsafe', 'high"\n-c evil=true', '$(command)', 'x'.repeat(33)])(
    'rejects malformed effort identifiers before runtime lookup: %s',
    (reasoningEffort) => {
      const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG
      expect(projectAgentSettingsSchema.safeParse({ ...settings, reasoningEffort }).success).toBe(
        false
      )
    }
  )
  it("prefers an exact model ID to another model's resolved alias", () => {
    const base = { label: 'Model', description: '', defaultReasoningEffort: null }
    expect(
      getProjectAgentModel(
        {
          status: 'ready',
          models: [
            { ...base, id: 'alias', aliases: ['model'], reasoningEfforts: ['high'] },
            { ...base, id: 'model', reasoningEfforts: ['low'] },
          ],
        },
        'model'
      )?.reasoningEfforts
    ).toEqual(['low'])
  })
})
