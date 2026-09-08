/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({
  env: { VIBE_VSCODE_AGENT_GATEWAY_SECRET: 'test-gateway-secret-not-a-credential-0123456789' },
}))
vi.mock('@/lib/api/server/routes/internal-json-route', () => ({
  internalSessionAuth: { authenticate: vi.fn() },
}))

import {
  isTrustedVscodeGateway,
  requireVscodeGateway,
  VSCODE_GATEWAY_HEADER,
} from '@/lib/vibe-vscode/gateway'

const secret = 'test-gateway-secret-not-a-credential-0123456789'
function request(headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://vscode.example.test/api/vscode/sessions', {
    method,
    headers: {
      [VSCODE_GATEWAY_HEADER]: secret,
      origin: 'https://vscode.example.test',
      'content-type': 'application/json',
      ...headers,
    },
  })
}

describe('VS Code gateway capability', () => {
  it('fails closed when no shared secret is configured', () => {
    expect(isTrustedVscodeGateway(new Headers({ [VSCODE_GATEWAY_HEADER]: secret }), '')).toBe(false)
  })
  it.each(['', 'short', 'different-secret-with-the-same-length-0123456789'])(
    'rejects missing or forged capability %s',
    (value) => {
      expect(() => requireVscodeGateway(request({ [VSCODE_GATEWAY_HEADER]: value }))).toThrow(
        'authenticated VS Code'
      )
    }
  )
  it('does not mistake an embed hint for execution authority', () => {
    expect(() =>
      requireVscodeGateway(request({ [VSCODE_GATEWAY_HEADER]: '', 'x-vibe-vscode-embed': '1' }))
    ).toThrow()
  })
  it.each([
    { origin: 'https://attacker.example.test' },
    { origin: 'http://vscode.example.test' },
    { origin: 'null' },
    { 'content-type': 'text/plain' },
    { 'sec-fetch-site': 'cross-site' },
  ])('rejects a cross-site/simple mutation %j', (headers) => {
    expect(() => requireVscodeGateway(request(headers))).toThrow('same-origin JSON')
  })
  it('accepts the main gateway with a matching browser origin', () => {
    expect(() => requireVscodeGateway(request())).not.toThrow()
    expect(() => requireVscodeGateway(request({}, 'GET'))).not.toThrow()
  })
  it('uses the main gateway public authority when an outer hosted proxy is present', () => {
    expect(() =>
      requireVscodeGateway(
        request({
          'x-original-host': 'public.example.test',
          'x-forwarded-host': '127.0.0.1:18080',
          'x-forwarded-proto': 'https',
          origin: 'https://public.example.test',
        })
      )
    ).not.toThrow()
  })
})
