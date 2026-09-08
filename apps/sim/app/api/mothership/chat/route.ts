import { isValidUuid } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import {
  mothershipChatGetQuerySchema,
  mothershipChatPostEnvelopeSchema,
} from '@/lib/api/contracts/mothership-chats'
import { localProjectChatBodySchema } from '@/lib/api/contracts/vscode-agents'
import { validationErrorResponse } from '@/lib/api/server'
import {
  internalOrchestrationErrorPolicy,
  internalSessionAuth,
} from '@/lib/api/server/routes/internal-json-route'
import { getSession } from '@/lib/auth'
import { handleUnifiedChatPost, maxDuration } from '@/lib/copilot/chat/post'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveProjectChatRuntime } from '@/lib/vibe-vscode/application/projects'
import { runProjectChat } from '@/lib/vibe-vscode/application/run-project-chat'
import { requireVscodeGateway } from '@/lib/vibe-vscode/gateway'
import { ProjectChatBusyError } from '@/lib/vibe-vscode/project-chat'
import { GET as copilotChatGet } from '@/app/api/copilot/chat/queries'

export { maxDuration }

// Unified chat route surface.
export const GET = withRouteHandler((request: NextRequest) => {
  const validation = mothershipChatGetQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  )
  if (!validation.success) return validationErrorResponse(validation.error)

  return copilotChatGet(request)
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // boundary-raw-json: shim pre-validates the mothership envelope before delegating to the copilot handler that consumes the body
  const body = await request
    .clone()
    .json()
    .catch(() => undefined)
  if (body !== undefined) {
    const validation = mothershipChatPostEnvelopeSchema.safeParse(body)
    if (!validation.success) return validationErrorResponse(validation.error)
    if (validation.data.chatId && isValidUuid(validation.data.chatId)) {
      try {
        const principal = await internalSessionAuth.authenticate()
        const runtime = await resolveProjectChatRuntime.execute({
          principal,
          input: { chatId: validation.data.chatId, workspaceId: validation.data.workspaceId },
        })
        if (runtime.local) {
          requireVscodeGateway(request)
          const parsed = localProjectChatBodySchema.safeParse(body)
          if (!parsed.success) return validationErrorResponse(parsed.error)
          return await runProjectChat.execute({ principal, input: parsed.data, request })
        }
      } catch (error) {
        if (error instanceof ProjectChatBusyError) {
          return NextResponse.json(
            { error: error.message, chatId: error.chatId, activeStreamId: error.activeStreamId },
            { status: 409 }
          )
        }
        const projected = internalOrchestrationErrorPolicy.project(error)
        if (projected) return NextResponse.json(projected.body, { status: projected.status })
        throw error
      }
    }
  }

  return handleUnifiedChatPost(request)
})
