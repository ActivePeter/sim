import { describe, expect, it } from 'vitest'
import {
  isVibeVscodeEmbeddedUrl,
  parseVibeVscodeSurface,
  publicVibeVscodePath,
  withVibeVscodeSurface,
} from '@/lib/vibe-vscode/surface'

describe('Vibe VS Code surface routes', () => {
  it('accepts only supported projection names', () => {
    expect([
      parseVibeVscodeSurface('editor'),
      parseVibeVscodeSurface('sidebar'),
      parseVibeVscodeSurface('fullscreen'),
      parseVibeVscodeSurface(undefined),
    ]).toEqual(['editor', 'sidebar', null, null])
  })

  it('preserves resource query and hash state when adding a projection', () => {
    expect(withVibeVscodeSurface('/workspace/ws/d/dag?tab=checks#node-2', 'editor')).toBe(
      '/workspace/ws/d/dag?tab=checks&_vscodeSurface=editor#node-2'
    )
  })

  it('identifies editor, sidebar, and fullscreen plugin projections', () => {
    expect([
      isVibeVscodeEmbeddedUrl(
        new URL('https://sim.local/workspace/ws/d/dag?_vscodeSurface=editor')
      ),
      isVibeVscodeEmbeddedUrl(
        new URL('https://sim.local/workspace/ws/d/dag?_vscodeSurface=sidebar')
      ),
      isVibeVscodeEmbeddedUrl(
        new URL('https://sim.local/workspace/ws/d/dag#_vscodeEmbed=trusted-token')
      ),
      isVibeVscodeEmbeddedUrl(new URL('https://sim.local/workspace/ws/d/dag')),
      isVibeVscodeEmbeddedUrl(
        new URL('https://sim.local/workspace/ws/d/dag?_vscodeSurface=fullscreen')
      ),
      isVibeVscodeEmbeddedUrl(new URL('https://sim.local/workspace/ws/d/dag#_vscodeEmbed=')),
    ]).toEqual([true, true, true, false, false, false])
  })

  it('removes host-only state from routes published to VS Code', () => {
    expect(
      publicVibeVscodePath(
        new URL(
          'https://sim.local/workspace/ws/w/workflow?panel=logs&_vscodeSurface=sidebar#_vscodeEmbed=token'
        )
      )
    ).toBe('/workspace/ws/w/workflow?panel=logs')
  })
})
