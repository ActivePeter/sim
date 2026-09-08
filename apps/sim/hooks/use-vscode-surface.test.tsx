/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VibeVscodeSurface } from '@/lib/vibe-vscode/surface'
import { useVscodeEmbedded, useVscodeSurface } from '@/hooks/use-vscode-surface'

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => navigation.searchParams }))

function installBridge(surface: VibeVscodeSurface | null) {
  window.vibeVscode = {
    getSurface: () => surface,
    getContext: () => undefined,
    openEditor: vi.fn(),
    openMonitor: vi.fn(),
    openFile: vi.fn(),
    openDiff: vi.fn(),
    openTerminal: vi.fn(),
    openExternal: vi.fn(),
  }
  window.dispatchEvent(new Event('vibe-vscode-context'))
}
function Surface() {
  return <output>{useVscodeSurface() ?? 'full-sim'}</output>
}
function Embedded() {
  return <output>{useVscodeEmbedded() ? 'embedded' : 'standalone'}</output>
}
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.vibeVscode = undefined
  navigation.searchParams = new URLSearchParams('_vscodeSurface=sidebar')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.vibeVscode = undefined
})

describe('mounted VS Code surface authority', () => {
  it('uses the route only before the bridge is available', () => {
    act(() => root.render(<Surface />))
    expect(container.textContent).toBe('sidebar')
    act(() => installBridge('editor'))
    expect(container.textContent).toBe('editor')
  })

  it('retains the sidebar when a native router transition drops host search state', () => {
    act(() => {
      installBridge('sidebar')
      root.render(<Surface />)
    })
    navigation.searchParams = new URLSearchParams()
    act(() => root.render(<Surface />))
    expect(container.textContent).toBe('sidebar')
  })

  it('gives a newly mounted chat the same sidebar identity after navigation', () => {
    act(() => installBridge('sidebar'))
    navigation.searchParams = new URLSearchParams()
    act(() => root.render(<Surface />))
    expect(container.textContent).toBe('sidebar')
  })

  it('does not turn the fullscreen monitor into a sidebar through query state', () => {
    act(() => {
      installBridge(null)
      root.render(<Surface />)
    })
    expect(container.textContent).toBe('full-sim')
  })

  it('recognizes fullscreen as embedded after its initial URL hints are gone', () => {
    navigation.searchParams = new URLSearchParams()
    act(() => {
      installBridge(null)
      root.render(<Embedded />)
    })
    expect(container.textContent).toBe('embedded')
  })

  it('does not hide standalone connection state without a bridge or surface hint', () => {
    navigation.searchParams = new URLSearchParams()
    act(() => root.render(<Embedded />))
    expect(container.textContent).toBe('standalone')
    act(() => installBridge(null))
    expect(container.textContent).toBe('embedded')
  })

  it('recognizes a sidebar route before its bridge is mounted', () => {
    act(() => root.render(<Embedded />))
    expect(container.textContent).toBe('embedded')
  })
})
