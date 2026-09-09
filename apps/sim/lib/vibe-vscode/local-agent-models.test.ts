/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/vibe-vscode/local-codex', () => ({ getLocalCodexModels: vi.fn() }))
vi.mock('@/lib/vibe-vscode/local-claude', () => ({ getLocalClaudeModels: vi.fn() }))

import type { ProjectAgentModel } from '@/lib/vibe-vscode/agent-config'
import { LocalAgentModelCatalogReader } from '@/lib/vibe-vscode/local-agent-models'

const models: ProjectAgentModel[] = [
  {
    id: 'test-model',
    label: 'Test',
    description: '',
    reasoningEfforts: ['low', 'ultra'],
    defaultReasoningEffort: 'low',
  },
]

describe('local Agent model discovery cache', () => {
  it('coalesces concurrent readers and caches from completion rather than request start', async () => {
    let time = 0
    let resolve!: (value: ProjectAgentModel[]) => void
    const deferred = new Promise<ProjectAgentModel[]>((done) => {
      resolve = done
    })
    const discover = vi.fn().mockReturnValue(deferred)
    const reader = new LocalAgentModelCatalogReader(discover, () => time)
    const first = reader.read('local-codex')
    const second = reader.read('local-codex')
    expect(first).toBe(second)
    await Promise.resolve()
    time = 60_000
    expect(reader.read('local-codex')).toBe(first)
    resolve(models)
    expect(await first).toEqual({ status: 'ready', models })
    time = 350_000
    expect(reader.read('local-codex')).toBe(first)
    expect(discover).toHaveBeenCalledExactlyOnceWith('local-codex')
    time = 360_001
    await reader.read('local-codex')
    expect(discover).toHaveBeenCalledTimes(2)
  })
  it('isolates runtimes and never replaces one catalog with a late response for another', async () => {
    let resolve!: (value: ProjectAgentModel[]) => void
    const deferred = new Promise<ProjectAgentModel[]>((done) => {
      resolve = done
    })
    const claudeModels = [
      { ...models[0], id: 'claude-test', reasoningEfforts: [], defaultReasoningEffort: null },
    ]
    const reader = new LocalAgentModelCatalogReader((id) =>
      id === 'local-codex' ? deferred : Promise.resolve(claudeModels)
    )
    const pending = reader.read('local-codex')
    expect(await reader.read('local-claude')).toEqual({ status: 'ready', models: claudeModels })
    resolve(models)
    await pending
    expect(await reader.read('local-claude')).toEqual({ status: 'ready', models: claudeModels })
  })
  it('returns a safe retryable failure, never a successful empty or stale catalog', async () => {
    let time = 0
    const discover = vi
      .fn()
      .mockResolvedValueOnce(models)
      .mockRejectedValueOnce(new Error('private runner credentials and paths'))
      .mockResolvedValueOnce([{ ...models[0], id: 'new-model' }])
    const reader = new LocalAgentModelCatalogReader(discover, () => time)
    await reader.read('local-codex')
    time = 300_001
    const failure = await reader.read('local-codex')
    expect(failure).toEqual({ status: 'error', message: expect.stringContaining('重试') })
    expect(JSON.stringify(failure)).not.toMatch(/private|test-model/)
    expect(await reader.read('local-codex')).toEqual({
      status: 'ready',
      models: [{ ...models[0], id: 'new-model' }],
    })
    expect(discover).toHaveBeenCalledTimes(3)
  })
  it.each([
    [],
    [models[0], models[0]],
    [{ ...models[0], defaultReasoningEffort: 'unsupported' }],
    [{ ...models[0], reasoningEfforts: ['low', 'low'] }],
  ])(
    'rejects incomplete or inconsistent discovery data without caching it: %j',
    async (invalid) => {
      const discover = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(models)
      const reader = new LocalAgentModelCatalogReader(discover)
      expect(await reader.read('local-codex')).toMatchObject({ status: 'error' })
      expect(await reader.read('local-codex')).toEqual({ status: 'ready', models })
    }
  )
})
