import { db } from '@sim/db'
import { copilotChats, copilotMessages, vscodeProjectSessions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { buildEffectiveChatTranscript } from '@/lib/copilot/chat/effective-transcript'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import { finalizeAssistantTurn } from '@/lib/copilot/chat/terminal-state'
import { chatPubSub } from '@/lib/copilot/chat-status'
import {
  acquirePendingChatStream,
  cleanupAbortMarker,
  createEvent,
  getChatStreamLockOwners,
  getPendingChatStreamId,
  isExplicitStopReason,
  type PersistedStreamEventEnvelope,
  registerActiveStream,
  releasePendingChatStream,
  resetBuffer,
  SSE_RESPONSE_HEADERS,
  type StreamEvent,
  StreamWriter,
  scheduleBufferCleanup,
  startAbortPoller,
  unregisterActiveStream,
} from '@/lib/copilot/request/session'
import { toStreamBatchEvent } from '@/lib/copilot/request/session/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runLocalCodex } from '@/lib/vibe-vscode/local-codex'
import { vscodeSessionOriginSchema } from '@/lib/vibe-vscode/types'
import { applyCodexEvent, createCodexTotals } from '@/executor/handlers/codex/core/events'

const logger = createLogger('VscodeProjectChat')

export interface StartProjectChatInput {
  workspaceId: string
  chatId: string
  userMessageId: string
  message: string
}

export class ProjectChatBusyError extends OrchestrationError {
  constructor(
    readonly chatId: string,
    readonly activeStreamId: string | null
  ) {
    super('conflict', 'This session already has a turn. Reconnect before sending another message.')
  }
}

/** Claims one native chat turn and appends its input in the same transaction. */
export async function startProjectChat(
  userId: string,
  input: StartProjectChatInput,
  cwd: string
): Promise<Response> {
  const chatId = input.chatId
  const streamId = input.userMessageId
  if (!(await acquirePendingChatStream(chatId, streamId, 0))) {
    throw new ProjectChatBusyError(chatId, await getPendingChatStreamId(chatId))
  }
  const userMessage: PersistedMessage = {
    id: streamId,
    role: 'user',
    content: input.message,
    timestamp: new Date().toISOString(),
  }
  let turn: { threadId?: string; prompt: string }
  let claimedTurn = false
  try {
    turn = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ chat: copilotChats, binding: vscodeProjectSessions })
        .from(copilotChats)
        .innerJoin(vscodeProjectSessions, eq(vscodeProjectSessions.chatId, copilotChats.id))
        .where(
          and(
            eq(copilotChats.id, chatId),
            eq(copilotChats.userId, userId),
            eq(copilotChats.workspaceId, input.workspaceId),
            isNull(copilotChats.deletedAt)
          )
        )
        .for('update')
        .limit(1)
      if (!row) throw new OrchestrationError('not_found', 'Project session not found')
      const [replay] = await tx
        .select({ messageId: copilotMessages.messageId })
        .from(copilotMessages)
        .where(and(eq(copilotMessages.chatId, chatId), eq(copilotMessages.messageId, streamId)))
        .limit(1)
      if (replay) throw new ProjectChatBusyError(chatId, null)
      const history = await tx
        .select({ messageId: copilotMessages.messageId, content: copilotMessages.content })
        .from(copilotMessages)
        .where(and(eq(copilotMessages.chatId, chatId), isNull(copilotMessages.deletedAt)))
        .orderBy(desc(copilotMessages.seq))
        .limit(1000)
      const origin = vscodeSessionOriginSchema.parse(row.binding.origin)
      // The client never chooses cwd, model credentials, or the runtime thread.
      const preamble =
        'You are the project agent for ' +
        origin.project.name +
        '.\n' +
        'This is Sim session ' +
        chatId +
        ', shared with VS Code. Work only on the user request.\n' +
        'The project working directory is ' +
        cwd +
        '. Follow its AGENTS.md instructions.\n'
      const historyText = row.binding.runtimeThreadId
        ? ''
        : history
            .reverse()
            .map((row) => {
              const message = row.content as PersistedMessage
              return `${message.role}: ${message.content}`
            })
            .join('\n\n')
            .slice(-96_000)
      await tx
        .update(copilotChats)
        .set({ conversationId: streamId, updatedAt: new Date() })
        .where(eq(copilotChats.id, chatId))
      await tx
        .update(vscodeProjectSessions)
        .set({ lastTurnId: streamId, lastOutcome: null })
        .where(eq(vscodeProjectSessions.chatId, chatId))
      await appendCopilotChatMessages(
        chatId,
        [userMessage],
        { streamId, chatModel: 'local-codex' },
        tx
      )
      return {
        threadId: row.binding.runtimeThreadId ?? undefined,
        prompt:
          preamble +
          (historyText ? `\nPrevious conversation:\n${historyText}\n\n` : '\n') +
          input.message,
      }
    })
    claimedTurn = true
    await resetBuffer(streamId)
  } catch (error) {
    // A failed claim (including a replay) never owns the durable marker. If stream setup fails
    // after the input commits, save a terminal response so that reopening is not left connecting.
    if (claimedTurn) {
      await finalizeAssistantTurn({
        chatId,
        userId,
        userMessageId: streamId,
        assistantMessage: {
          id: generateId(),
          role: 'assistant',
          content: 'The project agent stream could not start. Please send your request again.',
          timestamp: new Date().toISOString(),
        },
      }).catch(() => {})
      await db
        .update(vscodeProjectSessions)
        .set({ lastOutcome: 'error' })
        .where(
          and(
            eq(vscodeProjectSessions.chatId, chatId),
            eq(vscodeProjectSessions.lastTurnId, streamId)
          )
        )
        .catch(() => {})
    }
    await releasePendingChatStream(chatId, streamId)
    throw error
  }

  const writer = new StreamWriter({ streamId, chatId, requestId: streamId })
  let responseController: ReadableStreamDefaultController | undefined
  const controller = new AbortController()
  registerActiveStream(streamId, controller)
  const poller = startAbortPoller(streamId, controller, { chatId, requestId: streamId })
  let checkingOwnership = false
  let ownershipDeadline: ReturnType<typeof setTimeout> | undefined
  const ownershipPoller = setInterval(() => {
    if (checkingOwnership || controller.signal.aborted) return
    checkingOwnership = true
    ownershipDeadline = setTimeout(
      () => controller.abort('Local runner session ownership verification timed out.'),
      3000
    )
    void getChatStreamLockOwners([chatId])
      .then(
        (owners) => {
          if (owners.status !== 'verified' || owners.ownersByChatId.get(chatId) !== streamId) {
            controller.abort('Local runner lost verified session ownership.')
          }
        },
        () => controller.abort('Local runner could not verify session ownership.')
      )
      .finally(() => {
        clearTimeout(ownershipDeadline)
        checkingOwnership = false
      })
  }, 5000)
  const timeout = setTimeout(
    () => controller.abort('The local agent turn reached its 30 minute limit.'),
    30 * 60 * 1000
  )
  const events: PersistedStreamEventEnvelope[] = []
  let eventBytes = 0
  const publish = (event: StreamEvent) => {
    const seq = events.length + 1
    eventBytes += JSON.stringify(event).length
    if (eventBytes > 4_000_000 && event.type !== 'complete' && event.type !== 'error') {
      throw new Error('The local agent turn exceeded its transcript size limit.')
    }
    events.push(
      createEvent({ ...event, chatId, streamId, seq, cursor: String(seq), requestId: streamId })
    )
    writer.publish(event)
  }

  const execute = async () => {
    let outcome: 'complete' | 'error' | 'cancelled' = 'complete'
    const totals = createCodexTotals()
    try {
      publish({ type: 'session', payload: { kind: 'chat', chatId } })
      publish({ type: 'session', payload: { kind: 'start', data: { responseId: streamId } } })
      writer.startKeepalive()
      chatPubSub?.publishStatusChanged({
        workspaceId: input.workspaceId,
        chatId,
        streamId,
        type: 'started',
      })
      await runLocalCodex({
        cwd,
        threadId: turn.threadId,
        prompt: turn.prompt,
        signal: controller.signal,
        onEvent: async (event) => {
          applyCodexEvent(totals, event)
          switch (event.type) {
            case 'thread_started':
              await db
                .update(vscodeProjectSessions)
                .set({ runtimeThreadId: event.threadId })
                .where(
                  and(
                    eq(vscodeProjectSessions.chatId, chatId),
                    eq(vscodeProjectSessions.lastTurnId, streamId)
                  )
                )
              break
            case 'text':
              publish({
                type: 'text',
                payload: { channel: 'assistant', text: `${event.text}\n\n` },
              })
              break
            case 'thinking':
              publish({ type: 'text', payload: { channel: 'thinking', text: event.text } })
              break
            case 'tool_start':
              publish({
                type: 'tool',
                payload: {
                  phase: 'call',
                  executor: 'sim',
                  mode: 'sync',
                  toolCallId: event.id,
                  toolName: event.toolName,
                  status: 'executing',
                  arguments: { command: event.summary ?? '' },
                  ui: { clientExecutable: false, inbandOwned: true },
                },
              })
              break
            case 'tool_end':
              publish({
                type: 'tool',
                payload: {
                  phase: 'result',
                  executor: 'sim',
                  mode: 'sync',
                  toolCallId: event.id,
                  toolName: event.toolName,
                  success: !event.isError,
                  status: event.isError ? 'error' : 'success',
                  output: event.output,
                },
              })
              break
            case 'error':
              throw new Error(event.message)
          }
          await writer.flush()
        },
      })
      if (!totals.turnCompleted)
        throw new Error('The local runner ended without completing the turn.')
    } catch (error) {
      outcome =
        controller.signal.aborted && isExplicitStopReason(controller.signal.reason)
          ? 'cancelled'
          : 'error'
      if (outcome === 'error') {
        const message =
          controller.signal.aborted && typeof controller.signal.reason === 'string'
            ? controller.signal.reason
            : getErrorMessage(error, 'The project agent failed.')
        publish({
          type: 'error',
          payload: { message, code: 'local_agent_error', provider: 'local-codex' },
        })
      }
    } finally {
      try {
        const completion: StreamEvent = {
          type: 'complete',
          payload: {
            status: outcome,
            usage: {
              input_tokens: totals.inputTokens,
              output_tokens: totals.outputTokens,
              cache_read_input_tokens: totals.cachedInputTokens,
              model: 'local-codex',
            },
          },
        }
        const completionSeq = events.length + 1
        const completedEvents = [
          ...events,
          createEvent({
            ...completion,
            chatId,
            streamId,
            seq: completionSeq,
            cursor: String(completionSeq),
            requestId: streamId,
          }),
        ]
        const transcript = buildEffectiveChatTranscript({
          messages: [userMessage],
          activeStreamId: streamId,
          streamSnapshot: {
            events: completedEvents.map(toStreamBatchEvent),
            previewSessions: [],
            status: outcome,
          },
        })
        const assistant = transcript.find((message) => message.role === 'assistant')
        await finalizeAssistantTurn({
          chatId,
          userId,
          userMessageId: streamId,
          assistantMessage: assistant ? { ...assistant, id: generateId() } : undefined,
        })
        await db
          .update(vscodeProjectSessions)
          .set({ lastOutcome: outcome })
          .where(
            and(
              eq(vscodeProjectSessions.chatId, chatId),
              eq(vscodeProjectSessions.lastTurnId, streamId)
            )
          )
        // A successful terminal event is only observable after the native transcript is durable.
        publish(completion)
      } catch {
        logger.error('Failed to finalize project agent transcript', { chatId, streamId })
        publish({
          type: 'error',
          payload: {
            message: 'The response could not be saved. Reopen this session before retrying.',
            code: 'local_agent_persistence_error',
          },
        })
        publish({ type: 'complete', payload: { status: 'error' } })
      } finally {
        clearInterval(poller)
        clearInterval(ownershipPoller)
        clearTimeout(ownershipDeadline)
        clearTimeout(timeout)
        unregisterActiveStream(streamId)
        await writer.close().catch(() => {
          try {
            responseController?.close()
          } catch {
            /* Disconnected. */
          }
        })
        await Promise.allSettled([
          releasePendingChatStream(chatId, streamId),
          cleanupAbortMarker(streamId),
        ])
        scheduleBufferCleanup(streamId)
        chatPubSub?.publishStatusChanged({
          workspaceId: input.workspaceId,
          chatId,
          streamId,
          type: 'completed',
        })
      }
    }
  }

  const stream = new ReadableStream({
    start(streamController) {
      responseController = streamController
      writer.attach(streamController)
      void execute().catch(() =>
        logger.error('Project agent stream cleanup failed', { chatId, streamId })
      )
    },
    // Browser disconnect is not a Stop. The runner, native transcript and replay outbox survive it.
    cancel() {
      writer.markDisconnected()
    },
  })
  return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
}
