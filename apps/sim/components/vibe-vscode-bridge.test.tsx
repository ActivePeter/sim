/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const locale = vi.hoisted(() => ({ setLocale: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ useI18n: () => locale }))

import { VibeVscodeBridge } from '@/components/vibe-vscode-bridge'

interface BridgeMessage {
  type: string
  payload?: { path?: string; userInitiated?: boolean; uri?: string; title?: string }
}

let container: HTMLDivElement
let host: HTMLIFrameElement
let root: Root
let messages: BridgeMessage[]
const externalOpen = vi.fn<typeof window.open>(() => null)

function link(href: string, target = '') {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.target = target
  container.appendChild(anchor)
  return anchor
}

function editorRequests() {
  return messages.filter((message) => message.type === 'openEditor')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  messages = []
  window.history.replaceState(
    null,
    '',
    '/workspace/one/home?_vscodeSurface=sidebar#_vscodeEmbed=test-generation'
  )
  host = document.createElement('iframe')
  document.body.appendChild(host)
  vi.spyOn(window, 'parent', 'get').mockReturnValue(host.contentWindow!)
  vi.spyOn(host.contentWindow!, 'postMessage').mockImplementation((message: BridgeMessage) => {
    messages.push(message)
  })
  vi.stubGlobal('open', externalOpen)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<VibeVscodeBridge />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.removeItem('vibe-vscode-bridge-token:sidebar')
})

describe('embedded Sim navigation', () => {
  it('publishes startup and replacement routes without requesting editor focus', () => {
    window.history.replaceState(null, '', '/workspace/one/chat/restored')
    expect(messages.filter((message) => message.type === 'routeChanged')).toMatchObject([
      { payload: { path: '/workspace/one/home', userInitiated: false } },
      { payload: { path: '/workspace/one/chat/restored', userInitiated: false } },
    ])
    expect(editorRequests()).toEqual([])
    expect(new URLSearchParams(window.location.search).get('_vscodeSurface')).toBe('sidebar')
  })

  it('uses a committed route transition, not an expiring click timer, to open sidebar content', () => {
    vi.useFakeTimers()
    try {
      const anchor = link('/workspace/one/d/plan')
      anchor.addEventListener('click', (event) => event.preventDefault())
      anchor.click()
      vi.advanceTimersByTime(10_000)
      window.history.pushState(null, '', '/workspace/one/d/plan')
      expect(messages.at(-1)).toMatchObject({
        type: 'routeChanged',
        payload: { path: '/workspace/one/d/plan', userInitiated: true },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not treat a query-only update as selecting sidebar content', () => {
    window.history.pushState(null, '', '/workspace/one/home?project=selection')
    expect(messages.at(-1)).toMatchObject({
      type: 'routeChanged',
      payload: { userInitiated: false },
    })
  })

  it('reveals a closed editor when its current sidebar row is selected again', () => {
    const anchor = link('/workspace/one/home')
    anchor.addEventListener('click', (event) => event.preventDefault())
    anchor.click()
    expect(editorRequests()).toMatchObject([{ payload: { path: '/workspace/one/home' } }])
  })

  for (const target of ['_blank', '_top', '_parent']) {
    it(`keeps a ${target} Sim resource link inside VS Code`, () => {
      const anchor = link('/workspace/one/chat/session', target)
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      anchor.dispatchEvent(click)
      expect({ prevented: click.defaultPrevented, requests: editorRequests() }).toMatchObject({
        prevented: true,
        requests: [{ payload: { path: '/workspace/one/chat/session' } }],
      })
      expect(externalOpen).not.toHaveBeenCalled()
    })
  }

  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
    it(`keeps an unhandled ${modifier} link inside VS Code`, () => {
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      })
      link('/workspace/one/w/workflow').dispatchEvent(click)
      expect(click.defaultPrevented).toBe(true)
      expect(editorRequests()).toMatchObject([{ payload: { path: '/workspace/one/w/workflow' } }])
    })
  }

  it('preserves native shift-range selection and nested row actions', () => {
    const anchor = link('/workspace/one/chat/session')
    anchor.addEventListener('click', (event) => event.preventDefault())
    anchor.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })
    )
    const button = document.createElement('button')
    anchor.appendChild(button)
    button.click()
    expect(editorRequests()).toEqual([])
  })

  it('keeps middle-click resource navigation inside VS Code', () => {
    const click = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    link('/workspace/one/d/plan').dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(editorRequests()).toMatchObject([{ payload: { path: '/workspace/one/d/plan' } }])
  })

  it('adapts native open-in-new-tab actions without redirecting external docs or downloads', () => {
    expect(window.open('/workspace/one/chat/session', '_blank')).toBeNull()
    window.open('https://docs.example.test/help', '_blank')
    window.open('/api/files/download?fileId=one', '_blank')
    expect(editorRequests()).toMatchObject([{ payload: { path: '/workspace/one/chat/session' } }])
    expect(externalOpen.mock.calls).toEqual([
      ['https://docs.example.test/help', '_blank', undefined],
      ['/api/files/download?fileId=one', '_blank', undefined],
    ])
  })

  it('routes explicit same-origin resource opens through the editor capability', () => {
    window.vibeVscode!.openExternal(`${window.location.origin}/workspace/one/chat/session`)
    window.vibeVscode!.openExternal('https://docs.example.test/help')
    expect(messages.slice(-2)).toMatchObject([
      { type: 'openEditor', payload: { path: '/workspace/one/chat/session' } },
      { type: 'openExternal', payload: { uri: 'https://docs.example.test/help' } },
    ])
  })

  it('publishes resource titles independently of navigation intent', () => {
    window.vibeVscode!.setEditorTitle('/workspace/one/chat/session', 'Title from Sim')
    window.vibeVscode!.setEditorTitle('//other.invalid', 'Unsafe')
    window.vibeVscode!.setEditorTitle('/workspace/one/chat/session', ' ')
    expect(messages.filter((message) => message.type === 'titleChanged')).toEqual([
      {
        source: 'sim',
        token: 'test-generation',
        type: 'titleChanged',
        payload: { path: '/workspace/one/chat/session', title: 'Title from Sim' },
      },
    ])
    expect(editorRequests()).toEqual([])
  })

  it('announces readiness before consumers can send their initial title', () => {
    act(() => root.render(null))
    messages = []
    const publish = () => window.vibeVscode?.setEditorTitle('/workspace/one/home', 'Ready title')
    window.addEventListener('vibe-vscode-context', publish)
    try {
      act(() => root.render(<VibeVscodeBridge />))
      expect(messages.map((message) => message.type)).toEqual([
        'ready',
        'routeChanged',
        'titleChanged',
      ])
    } finally {
      window.removeEventListener('vibe-vscode-context', publish)
    }
  })

  it('releases window navigation interception when the host bridge unmounts', () => {
    act(() => root.render(null))
    window.open('/workspace/one/chat/session', '_blank')
    expect(editorRequests()).toEqual([])
    expect(externalOpen).toHaveBeenCalledExactlyOnceWith('/workspace/one/chat/session', '_blank')
    expect(window.vibeVscode).toBeUndefined()
  })
})
