/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(),
  codex: vi.fn(),
  claude: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ access: mocks.access, stat: mocks.stat }))
vi.mock('@/lib/core/config/env', () => ({ env: {} }))
vi.mock('@/lib/vibe-vscode/local-codex', () => ({ runLocalCodex: mocks.codex }))
vi.mock('@/lib/vibe-vscode/local-claude', () => ({ runLocalClaude: mocks.claude }))

import { DEFAULT_PROJECT_AGENT_CONFIG } from '@/lib/vibe-vscode/agent-config'
import {
  getProjectAgentCapabilities,
  runProjectAgent,
  validateProjectAgentSettings,
} from '@/lib/vibe-vscode/local-agents'

const { version: _version, revision: _revision, ...settings } = DEFAULT_PROJECT_AGENT_CONFIG
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PATH', '/bin:/usr/bin')
  mocks.access.mockResolvedValue(undefined)
  mocks.stat.mockResolvedValue({ isFile: () => true })
})
afterEach(() => vi.unstubAllEnvs())

describe('server-owned project Agent capabilities', () => {
  it('only enables installed executables and never reads credentials', async () => {
    mocks.access.mockImplementation(async (path: string) => {
      if (path.endsWith('/claude')) throw new Error('not installed')
    })
    const agents = await getProjectAgentCapabilities()
    expect(agents.map(({ id, available }) => ({ id, available }))).toEqual([
      { id: 'local-codex', available: true },
      { id: 'local-claude', available: false },
    ])
    expect(mocks.codex).not.toHaveBeenCalled()
    expect(mocks.claude).not.toHaveBeenCalled()
    expect(JSON.stringify(agents)).not.toContain('/bin/')
  })
  it('does not mistake a directory on PATH for an executable', async () => {
    mocks.stat.mockResolvedValue({ isFile: () => false })
    expect((await getProjectAgentCapabilities()).every((agent) => !agent.available)).toBe(true)
  })
  it('validates actual runtime effort capabilities and normalizes input', async () => {
    await expect(
      validateProjectAgentSettings({ ...settings, reasoningEffort: 'max' })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      validateProjectAgentSettings({ ...settings, agentId: 'local-claude', reasoningEffort: 'max' })
    ).resolves.toMatchObject({ agentId: 'local-claude', reasoningEffort: 'max' })
    const value = await validateProjectAgentSettings({
      ...settings,
      model: ' model-one ',
      instructions: ' Chinese ',
    })
    expect(value).toMatchObject({ model: 'model-one', instructions: 'Chinese' })
    expect(Object.isFrozen(value)).toBe(true)
  })
  it('routes a versioned snapshot only to its saved runtime', async () => {
    const turn = {
      cwd: '/projects/a',
      threadId: 'stored-thread',
      prompt: 'Task',
      signal: new AbortController().signal,
      onEvent: vi.fn(),
      settings: { ...DEFAULT_PROJECT_AGENT_CONFIG, agentId: 'local-claude' as const, revision: 3 },
    }
    await runProjectAgent(turn)
    expect(mocks.claude).toHaveBeenCalledWith({
      ...turn,
      settings: { ...settings, agentId: 'local-claude' },
    })
    expect(mocks.codex).not.toHaveBeenCalled()
    await runProjectAgent({ ...turn, settings: DEFAULT_PROJECT_AGENT_CONFIG })
    expect(mocks.codex).toHaveBeenCalledTimes(1)
  })
  it('does not silently fall back to another Agent when the selected one disappears', async () => {
    mocks.access.mockRejectedValue(new Error('missing executable'))
    await expect(
      runProjectAgent({
        cwd: '/projects/a',
        prompt: 'Task',
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        settings,
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.codex).not.toHaveBeenCalled()
    expect(mocks.claude).not.toHaveBeenCalled()
  })
})
