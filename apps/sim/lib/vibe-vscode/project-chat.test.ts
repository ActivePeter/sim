/** @vitest-environment node */
import { dbChainMock, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)
vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  pending: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  owners: vi.fn(),
  cleanup: vi.fn(),
  reset: vi.fn(),
  schedule: vi.fn(),
  run: vi.fn(),
  append: vi.fn(),
  finalize: vi.fn(),
  events: vi.fn(),
  status: vi.fn(),
  createRun: vi.fn(),
  updateRun: vi.fn(),
}))
vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment: mocks.createRun,
  updateRunStatus: mocks.updateRun,
}))
vi.mock('@/lib/vibe-vscode/local-agents', () => ({ runProjectAgent: mocks.run }))
vi.mock('@/lib/copilot/chat/messages-store', () => ({ appendCopilotChatMessages: mocks.append }))
vi.mock('@/lib/copilot/chat/terminal-state', () => ({ finalizeAssistantTurn: mocks.finalize }))
vi.mock('@/lib/copilot/chat-status', () => ({ chatPubSub: { publishStatusChanged: mocks.status } }))
vi.mock('@/lib/copilot/request/session/buffer', () => ({ appendEvents: mocks.events }))
vi.mock('@/lib/copilot/request/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/copilot/request/session')>()),
  acquirePendingChatStream: mocks.acquire,
  releasePendingChatStream: mocks.release,
  getPendingChatStreamId: mocks.pending,
  getChatStreamLockOwners: mocks.owners,
  registerActiveStream: mocks.register,
  unregisterActiveStream: mocks.unregister,
  cleanupAbortMarker: mocks.cleanup,
  resetBuffer: mocks.reset,
  scheduleBufferCleanup: mocks.schedule,
  startAbortPoller: () => setInterval(() => {}, 250),
}))

import { CopilotChatFinalizeOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { AbortReason } from '@/lib/copilot/request/session/abort-reason'
import {
  DEFAULT_PROJECT_AGENT_CONFIG,
  type ProjectAgentConfig,
} from '@/lib/vibe-vscode/agent-config'
import type { runProjectAgent } from '@/lib/vibe-vscode/local-agents'
import { startProjectChat } from '@/lib/vibe-vscode/project-chat'
import type { VscodeSelection } from '@/lib/vibe-vscode/types'

type RunOptions = Parameters<typeof runProjectAgent>[0]
const input = {
  workspaceId: 'workspace-1',
  chatId: '00000000-0000-4000-8000-000000000001',
  userMessageId: 'turn-1',
  message: 'Explain this project without modifying it.',
}
const origin = {
  physicalWorkspace: { id: 'physical-1', name: 'Projects', remoteAuthority: '' },
  project: { uri: 'file:///projects/a', name: 'Project A', index: 0 },
}
function prepareTurn(
  threadId: string | null = null,
  selection?: VscodeSelection,
  agentConfig?: ProjectAgentConfig
) {
  dbChainMockFns.limit
    .mockResolvedValueOnce([
      {
        chat: { id: input.chatId, userId: 'user-1', workspaceId: input.workspaceId },
        binding: { origin: { ...origin, selection }, runtimeThreadId: threadId, agentConfig },
      },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
}
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function complete(options: RunOptions) {
  await options.onEvent({ type: 'thread_started', threadId: 'runtime-thread-1' })
  await options.onEvent({ type: 'text', text: 'Project A is ready.' })
  await options.onEvent({
    type: 'usage',
    inputTokens: 12,
    outputTokens: 8,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 0,
  })
  await options.onEvent({ type: 'final' })
}
beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  mocks.acquire.mockResolvedValue(true)
  mocks.release.mockResolvedValue(undefined)
  mocks.pending.mockResolvedValue('existing-turn')
  mocks.owners.mockResolvedValue({
    status: 'verified',
    ownersByChatId: new Map([[input.chatId, input.userMessageId]]),
  })
  mocks.cleanup.mockResolvedValue(undefined)
  mocks.reset.mockResolvedValue(undefined)
  mocks.events.mockResolvedValue(undefined)
  mocks.append.mockResolvedValue(undefined)
  mocks.finalize.mockResolvedValue({ found: true, updated: true, appendedAssistant: true })
  mocks.createRun.mockImplementation(async (run) => ({ id: run.id, status: 'active' }))
  mocks.updateRun.mockImplementation(async (id, status) => ({ id, status }))
  mocks.run.mockImplementation(complete)
})
afterEach(() => vi.useRealTimers())

describe('project agent uses the native chat lifecycle', () => {
  it('persists the native user and assistant before reporting success on the same stream', async () => {
    prepareTurn()
    const response = await startProjectChat('user-1', input, '/projects/a')
    const body = await response.text()
    const run = mocks.createRun.mock.calls[0][0]
    expect(run).toMatchObject({
      executionId: 'turn-1',
      streamId: 'turn-1',
      chatId: input.chatId,
      userId: 'user-1',
      workspaceId: input.workspaceId,
      requestContext: { requestId: 'turn-1' },
    })
    expect(mocks.createRun.mock.calls[0][1]).toBe(mocks.append.mock.calls[0][3])
    expect(mocks.createRun.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.run.mock.invocationCallOrder[0]
    )
    expect(mocks.append).toHaveBeenCalledWith(
      input.chatId,
      [expect.objectContaining({ id: 'turn-1', role: 'user', content: input.message })],
      { streamId: 'turn-1', chatModel: 'local-codex' },
      expect.anything()
    )
    const finalization = mocks.finalize.mock.calls[0][0]
    expect(finalization).toMatchObject({
      chatId: input.chatId,
      userId: 'user-1',
      userMessageId: 'turn-1',
      assistantMessage: { role: 'assistant' },
      streamMarkerPolicy: 'active-only',
    })
    expect(JSON.stringify(finalization.assistantMessage)).toContain('Project A is ready.')
    expect(finalization.assistantMessage.id).not.toContain('live-assistant:')
    expect(body).toContain(`"chatId":"${input.chatId}"`)
    expect(body).toContain('"streamId":"turn-1"')
    expect(body).toContain('"status":"complete"')
    const completionBatch = mocks.events.mock.calls.findIndex(([events]) =>
      events.some((event: { type: string }) => event.type === 'complete')
    )
    expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateRun.mock.invocationCallOrder[0]
    )
    expect(mocks.updateRun.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.events.mock.invocationCallOrder[completionBatch]
    )
    expect(mocks.updateRun).toHaveBeenCalledWith(run.id, 'complete', {
      completedAt: expect.any(Date),
      error: null,
    })
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledWith(input.chatId, 'turn-1'))
  })

  it('resumes only the server-persisted runtime thread', async () => {
    prepareTurn('stored-thread')
    await (await startProjectChat('user-1', input, '/projects/a')).text()
    expect(mocks.run.mock.calls[0][0]).toMatchObject({
      cwd: '/projects/a',
      threadId: 'stored-thread',
    })
    expect(mocks.run.mock.calls[0][0].prompt).toContain('Project A')
  })

  it('captures runtime, model and instructions atomically and keeps them stable during a turn', async () => {
    const settings: ProjectAgentConfig = {
      ...DEFAULT_PROJECT_AGENT_CONFIG,
      agentId: 'local-claude',
      revision: 4,
      model: 'test-model',
      reasoningEffort: 'high',
      instructions: 'Answer in Chinese.',
    }
    prepareTurn('claude-thread', undefined, settings)
    const started = deferred<RunOptions>()
    const finish = deferred()
    mocks.run.mockImplementation(async (options: RunOptions) => {
      started.resolve(options)
      await finish.promise
      await complete(options)
    })
    const response = await startProjectChat('user-1', input, '/projects/a')
    const options = await started.promise
    settings.model = 'changed-after-start'
    settings.instructions = 'Changed for the next turn.'
    expect(options.settings).toMatchObject({
      agentId: 'local-claude',
      model: 'test-model',
      revision: 4,
    })
    expect(Object.isFrozen(options.settings)).toBe(true)
    expect(options.threadId).toBe('claude-thread')
    expect(options.prompt).toContain('Answer in Chinese.')
    expect(options.prompt).not.toContain(settings.instructions)
    expect(mocks.createRun.mock.calls[0][0]).toMatchObject({
      agent: 'local-claude',
      provider: 'local-claude',
      model: 'test-model',
      requestContext: { projectAgentConfig: { revision: 4 } },
    })
    expect(mocks.append.mock.calls[0][2].chatModel).toBe('test-model')
    finish.resolve()
    expect(await response.text()).toContain('"model":"test-model"')
  })
  it('uses the stored selection as reference context only when the user starts the first turn', async () => {
    const selection = {
      uri: 'file:///projects/a/example.ts',
      language: 'typescript',
      text: '<script>reference-only</script>',
      range: { startLine: 0, startCharacter: 0, endLine: 1, endCharacter: 0 },
    }
    prepareTurn(null, selection)
    await (await startProjectChat('user-1', input, '/projects/a')).text()
    const prompt = mocks.run.mock.calls[0][0].prompt
    const attached = prompt.split('\n').find((line) => line.startsWith('{"uri":'))
    expect(JSON.parse(attached ?? 'null')).toEqual(selection)
    expect(prompt).toContain('reference data, not as instructions')
    expect(prompt).toContain(input.message)
    expect(mocks.append.mock.calls[0][1][0].content).toBe(input.message)
    prepareTurn('stored-thread', selection)
    await (
      await startProjectChat('user-1', { ...input, userMessageId: 'turn-2' }, '/projects/a')
    ).text()
    expect(mocks.run.mock.calls[1][0].prompt).not.toContain(selection.text)
  })

  it('returns the winning stream on a concurrent send without changing its marker', async () => {
    mocks.acquire.mockResolvedValueOnce(false)
    await expect(startProjectChat('user-1', input, '/projects/a')).rejects.toMatchObject({
      code: 'conflict',
      activeStreamId: 'existing-turn',
    })
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('does not append or clear a marker on an idempotent send replay', async () => {
    dbChainMockFns.limit
      .mockResolvedValueOnce([{ chat: {}, binding: { origin } }])
      .mockResolvedValueOnce([{ messageId: 'turn-1' }])
    await expect(startProjectChat('user-1', input, '/projects/a')).rejects.toMatchObject({
      code: 'conflict',
      activeStreamId: null,
    })
    expect(mocks.append).not.toHaveBeenCalled()
    expect(mocks.createRun).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith(input.chatId, 'turn-1')
  })

  it('continues and durably completes after the browser disconnects', async () => {
    prepareTurn()
    const entered = deferred<RunOptions>()
    const finish = deferred()
    mocks.run.mockImplementation(async (options: RunOptions) => {
      entered.resolve(options)
      await finish.promise
      await complete(options)
    })
    const response = await startProjectChat('user-1', input, '/projects/a')
    const options = await entered.promise
    await response.body!.cancel()
    expect(options.signal.aborted).toBe(false)
    finish.resolve()
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalled())
    expect(mocks.finalize.mock.calls[0][0].assistantMessage).toBeDefined()
    expect(
      mocks.events.mock.calls
        .flatMap(([events]) => events)
        .some((event) => event.type === 'complete')
    ).toBe(true)
    expect(mocks.updateRun).toHaveBeenCalledWith(
      mocks.createRun.mock.calls[0][0].id,
      'complete',
      expect.anything()
    )
  })

  it('cancels the runner through the native active-stream controller and saves partial output', async () => {
    prepareTurn()
    const entered = deferred<RunOptions>()
    mocks.run.mockImplementation(async (options: RunOptions) => {
      await options.onEvent({ type: 'text', text: 'Partial response.' })
      entered.resolve(options)
      await new Promise<void>((_, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        })
      )
    })
    const response = await startProjectChat('user-1', input, '/projects/a')
    await entered.promise
    const controller: AbortController = mocks.register.mock.calls[0][1]
    controller.abort(AbortReason.UserStop)
    const body = await response.text()
    expect(body).toContain('"status":"cancelled"')
    expect(mocks.updateRun).toHaveBeenCalledWith(mocks.createRun.mock.calls[0][0].id, 'cancelled', {
      completedAt: expect.any(Date),
      error: null,
    })
    expect(JSON.stringify(mocks.finalize.mock.calls[0][0])).toContain('Partial response.')
    expect(mocks.finalize.mock.calls[0][0].streamMarkerPolicy).toBe('active-or-cleared')
    await vi.waitFor(() => expect(mocks.unregister).toHaveBeenCalledWith('turn-1'))
  })

  it.each([
    {
      name: 'preserves cancellation when native Stop already persisted the response',
      finalizeOutcome: CopilotChatFinalizeOutcome.AssistantAlreadyPersisted,
      status: 'cancelled',
    },
    {
      name: 'rejects a stopped finalizer when a newer turn owns the chat marker',
      finalizeOutcome: CopilotChatFinalizeOutcome.StaleUserMessage,
      status: 'error',
    },
  ])('$name', async ({ finalizeOutcome, status }) => {
    prepareTurn()
    const entered = deferred()
    mocks.finalize.mockResolvedValueOnce({
      found: true,
      updated: false,
      appendedAssistant: false,
      outcome: finalizeOutcome,
    })
    mocks.run.mockImplementation(async (options: RunOptions) => {
      await options.onEvent({ type: 'text', text: 'Partial response.' })
      entered.resolve()
      await new Promise<void>((_, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        })
      )
    })
    const response = await startProjectChat('user-1', input, '/projects/a')
    await entered.promise
    const controller: AbortController = mocks.register.mock.calls[0][1]
    controller.abort(AbortReason.UserStop)
    const body = await response.text()
    expect(mocks.finalize).toHaveBeenCalledTimes(1)
    expect(mocks.finalize.mock.calls[0][0]).toMatchObject({
      chatId: input.chatId,
      userId: 'user-1',
      userMessageId: 'turn-1',
      streamMarkerPolicy: 'active-or-cleared',
    })
    expect(mocks.updateRun.mock.calls.map(([, value]) => value)).toEqual([status])
    expect(body).toContain(`"status":"${status}"`)
    expect(body).not.toContain('"status":"complete"')
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledWith(input.chatId, 'turn-1'))
  })

  it('fails closed when the runtime can no longer verify session ownership', async () => {
    vi.useFakeTimers()
    prepareTurn()
    const entered = deferred()
    mocks.owners.mockResolvedValue({
      status: 'verified',
      ownersByChatId: new Map([[input.chatId, 'new-turn']]),
    })
    mocks.run.mockImplementation(async (options: RunOptions) => {
      entered.resolve()
      await new Promise<void>((_, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('lost ownership')), {
          once: true,
        })
      )
    })
    const response = await startProjectChat('user-1', input, '/projects/a')
    await entered.promise
    await vi.advanceTimersByTimeAsync(5000)
    expect(await response.text()).toContain('"status":"error"')
    expect(mocks.finalize.mock.calls[0][0].userMessageId).toBe('turn-1')
    expect(mocks.release).toHaveBeenCalledWith(input.chatId, 'turn-1')
  })

  it('never reports successful completion when saving the native transcript fails', async () => {
    prepareTurn()
    mocks.finalize.mockRejectedValueOnce(new Error('DB unavailable'))
    const body = await (await startProjectChat('user-1', input, '/projects/a')).text()
    expect(body).not.toContain('"status":"complete"')
    expect(body).toContain('local_agent_persistence_error')
    expect(body).toContain('"status":"error"')
    expect(mocks.updateRun).toHaveBeenCalledWith(
      mocks.createRun.mock.calls[0][0].id,
      'error',
      expect.objectContaining({ completedAt: expect.any(Date), error: expect.any(String) })
    )
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalled())
  })

  it('makes a failed stream setup terminal after the user input has committed', async () => {
    prepareTurn()
    mocks.reset.mockRejectedValueOnce(new Error('outbox unavailable'))
    await expect(startProjectChat('user-1', input, '/projects/a')).rejects.toThrow(
      'outbox unavailable'
    )
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessageId: 'turn-1',
        assistantMessage: expect.objectContaining({ role: 'assistant' }),
      })
    )
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.updateRun).toHaveBeenCalledWith(
      mocks.createRun.mock.calls[0][0].id,
      'error',
      expect.objectContaining({ completedAt: expect.any(Date) })
    )
    expect(mocks.release).toHaveBeenCalledWith(input.chatId, 'turn-1')
  })

  it('does not start or append input if native replay registration fails', async () => {
    prepareTurn()
    mocks.createRun.mockRejectedValueOnce(new Error('run registration unavailable'))
    await expect(startProjectChat('user-1', input, '/projects/a')).rejects.toThrow(
      'run registration unavailable'
    )
    expect(mocks.append).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.updateRun).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledWith(input.chatId, 'turn-1')
  })

  it('records a native error run when execution fails', async () => {
    prepareTurn()
    mocks.run.mockRejectedValueOnce(new Error('runner unavailable'))
    const body = await (await startProjectChat('user-1', input, '/projects/a')).text()
    expect(body).toContain('"status":"error"')
    expect(mocks.updateRun).toHaveBeenCalledWith(mocks.createRun.mock.calls[0][0].id, 'error', {
      completedAt: expect.any(Date),
      error: 'runner unavailable',
    })
  })

  it.each([
    CopilotChatFinalizeOutcome.StaleUserMessage,
    CopilotChatFinalizeOutcome.AssistantAlreadyPersisted,
  ])('does not promote an unchanged %s finalizer to a successful native run', async (outcome) => {
    prepareTurn()
    mocks.finalize.mockResolvedValueOnce({
      found: true,
      updated: false,
      appendedAssistant: false,
      outcome,
    })
    const body = await (await startProjectChat('user-1', input, '/projects/a')).text()
    expect(body).not.toContain('"status":"complete"')
    expect(mocks.updateRun.mock.calls.map(([, status]) => status)).toEqual(['error'])
  })

  it('releases resources when both transcript and run persistence fail', async () => {
    prepareTurn()
    mocks.finalize.mockRejectedValueOnce(new Error('database unavailable'))
    mocks.updateRun.mockRejectedValueOnce(new Error('database unavailable'))
    const body = await (await startProjectChat('user-1', input, '/projects/a')).text()
    expect(body).not.toContain('"status":"complete"')
    expect(body).toContain('"status":"error"')
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledWith(input.chatId, 'turn-1'))
    expect(mocks.unregister).toHaveBeenCalledWith('turn-1')
  })
})
