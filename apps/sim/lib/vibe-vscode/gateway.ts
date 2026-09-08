import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { internalSessionAuth } from '@/lib/api/server/routes/internal-json-route'
import { env } from '@/lib/core/config/env'
import { HttpError } from '@/lib/core/utils/http-error'

export const VSCODE_GATEWAY_HEADER = 'x-vibe-agent-gateway'

class VscodeGatewayForbiddenError extends HttpError {
  readonly statusCode = 403
}

export function isTrustedVscodeGateway(
  headers: Headers,
  secret = env.VIBE_VSCODE_AGENT_GATEWAY_SECRET
): boolean {
  const supplied = headers.get(VSCODE_GATEWAY_HEADER)
  if (!secret || secret.length < 32 || !supplied) return false
  const expectedBytes = Buffer.from(secret)
  const suppliedBytes = Buffer.from(supplied)
  return (
    expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
  )
}

export function requireVscodeGateway(request: Request): void {
  if (!isTrustedVscodeGateway(request.headers)) {
    throw new VscodeGatewayForbiddenError(
      'Open project agents through the authenticated VS Code / Sim gateway.'
    )
  }
  if (request.method === 'GET' || request.method === 'HEAD') return
  const origin = request.headers.get('origin')
  const host = (
    request.headers.get('x-original-host') ||
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    new URL(request.url).host
  )
    .split(',')[0]
    .trim()
  const protocol =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    new URL(request.url).protocol.slice(0, -1)
  let sameOrigin = false
  try {
    sameOrigin = !!origin && new URL(origin).origin === `${protocol}://${host}`
  } catch {
    /* Reject malformed origins. */
  }
  if (
    !sameOrigin ||
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  ) {
    throw new VscodeGatewayForbiddenError(
      'Project agent mutations require a same-origin JSON request.'
    )
  }
}

/** The gateway grants host execution, not a Sim identity. Sim still authenticates its own session. */
export const vscodeGatewaySessionAuth = {
  async authenticate(request: NextRequest) {
    requireVscodeGateway(request)
    return internalSessionAuth.authenticate()
  },
}
