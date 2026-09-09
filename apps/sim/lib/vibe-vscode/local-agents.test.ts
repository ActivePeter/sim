/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(),
  codex: vi.fn(),
  claude: vi.fn(),
  models: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({ access: mocks.access, stat: mocks.stat }))
vi.mock('@/lib/core/config/env', () => ({ env: {} }))
vi.mock('@/lib/vibe-vscode/local-codex', () => ({ runLocalCodex: mocks.codex }))
vi.mock('@/lib/vibe-vscode/local-claude', () => ({ runLocalClaude: mocks.claude }))
vi.mock('@/lib/vibe-vscode/local-agent-models', () => ({
  localAgentModelCatalogs: { read: mocks.models },
}))

import {
  DEFAULT_PROJECT_AGENT_CONFIG,
  type ProjectAgentModelCatalog,
} from '@/lib/vibe-vscode/agent-config'
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
  mocks.models.mockResolvedValue({
    status: 'ready',
    models: [
      {
        id: 'model-one',
        label: 'One',
        description: '',
        reasoningEfforts: ['low', 'high'],
        defaultReasoningEffort: 'low',
      },
      {
        id: 'model-two',
        aliases: ['full-model-two'],
        label: 'Two',
        description: '',
        reasoningEfforts: ['high', 'max', 'ultra'],
        defaultReasoningEffort: 'high',
      },
      {
        id: 'no-reasoning',
        label: 'Simple',
        description: '',
        reasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ],
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('server-owned project Agent capabilities', () => {
  it('only discovers models for installed executables and never sends a turn', async () => {
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
    expect(mocks.models).toHaveBeenCalledExactlyOnceWith('local-codex')
    expect(JSON.stringify(agents)).not.toContain('/bin/')
  })
  it('does not mistake a directory on PATH for an executable', async () => {
    mocks.stat.mockResolvedValue({ isFile: () => false })
    expect((await getProjectAgentCapabilities()).every((agent) => !agent.available)).toBe(true)
  })
  it('validates each model independently, including new levels supplied by the runtime', async () => {
    await expect(
      validateProjectAgentSettings({ ...settings, model: 'model-one', reasoningEffort: 'max' })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      validateProjectAgentSettings({ ...settings, model: 'model-two', reasoningEffort: 'ultra' })
    ).resolves.toMatchObject({ model: 'model-two', reasoningEffort: 'ultra' })
    const value = await validateProjectAgentSettings({
      ...settings,
      model: ' model-one ',
      instructions: ' Chinese ',
    })
    expect(value).toMatchObject({ model: 'model-one', instructions: 'Chinese' })
    expect(Object.isFrozen(value)).toBe(true)
  })
  it('recognizes only aliases attested by the same runtime and rejects unknown models', async () => {
    await expect(
      validateProjectAgentSettings({ ...settings, model: 'full-model-two', reasoningEffort: 'max' })
    ).resolves.toMatchObject({ model: 'full-model-two', reasoningEffort: 'max' })
    await expect(
      validateProjectAgentSettings({ ...settings, model: 'unlisted' })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      validateProjectAgentSettings({ ...settings, model: 'no-reasoning', reasoningEffort: 'low' })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(
      validateProjectAgentSettings({ ...settings, model: 'no-reasoning' })
    ).resolves.toMatchObject({ model: 'no-reasoning', reasoningEffort: null })
  })
  it('does not invent a default model/level pairing or block inherited defaults on catalog failure', async () => {
    await expect(
      validateProjectAgentSettings({ ...settings, reasoningEffort: 'high' })
    ).rejects.toMatchObject({ code: 'validation' })
    await expect(validateProjectAgentSettings(settings)).resolves.toEqual(settings)
    expect(mocks.models).not.toHaveBeenCalled()
    mocks.models.mockResolvedValue({ status: 'error', message: 'Catalog offline; retry' })
    await expect(
      validateProjectAgentSettings({ ...settings, model: 'model-one' })
    ).rejects.toMatchObject({ code: 'validation', message: 'Catalog offline; retry' })
  })
  it('keeps discovery failure distinct from an unavailable executable', async () => {
    mocks.models.mockResolvedValue({ status: 'error', message: 'Catalog offline' })
    const agents = await getProjectAgentCapabilities()
    expect(agents.map(({ available, modelCatalog }) => ({ available, modelCatalog }))).toEqual([
      { available: true, modelCatalog: { status: 'error', message: 'Catalog offline' } },
      { available: true, modelCatalog: { status: 'error', message: 'Catalog offline' } },
    ])
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
  it('rejects an invalid model/level before starting a process and applies model-specific defaults at execution', async () => {
    const turn = {
      cwd: '/projects/a',
      prompt: 'Task',
      signal: new AbortController().signal,
      onEvent: vi.fn(),
    }
    await expect(
      runProjectAgent({
        ...turn,
        settings: { ...settings, model: 'model-one', reasoningEffort: 'ultra' },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.codex).not.toHaveBeenCalled()
    await runProjectAgent({ ...turn, settings: { ...settings, model: 'model-one' } })
    expect(mocks.codex).toHaveBeenCalledWith({
      ...turn,
      settings: { ...settings, model: 'model-one', reasoningEffort: 'low' },
    })
    expect(Object.isFrozen(mocks.codex.mock.calls[0][0].settings)).toBe(true)
  })
  it('never starts a turn cancelled before or during model discovery', async () => {
    const controller = new AbortController()
    const turn = {
      cwd: '/projects/a',
      prompt: 'Task',
      signal: controller.signal,
      onEvent: vi.fn(),
      settings: { ...settings, model: 'model-one' },
    }
    let resolve!: (value: ProjectAgentModelCatalog) => void
    let started!: () => void
    const startedPromise = new Promise<void>((done) => {
      started = done
    })
    mocks.models.mockImplementation(() => {
      started()
      return new Promise((done) => {
        resolve = done
      })
    })
    const pending = runProjectAgent(turn)
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await startedPromise
    controller.abort()
    resolve({
      status: 'ready',
      models: [
        {
          id: 'model-one',
          label: 'One',
          description: '',
          reasoningEfforts: ['low'],
          defaultReasoningEffort: 'low',
        },
      ],
    })
    await rejected
    expect(mocks.codex).not.toHaveBeenCalled()
    expect(mocks.claude).not.toHaveBeenCalled()
    await expect(runProjectAgent(turn)).rejects.toThrow('cancelled')
    expect(mocks.models).toHaveBeenCalledOnce()
  })
})
