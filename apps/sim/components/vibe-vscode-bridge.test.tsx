/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const locale = vi.hoisted(() => ({ setLocale: vi.fn() }))
const router = vi.hoisted(() => ({ replace: vi.fn() }))
const creation = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ useI18n: () => locale }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ ...router }) }))
vi.mock('@/hooks/queries/vscode-agents', () => ({
  useCreateProjectSessionFromSelection: () => creation.create,
}))

import { VibeVscodeBridge } from '@/components/vibe-vscode-bridge'

interface BridgeMessage {
  type: string
  payload?: {
    path?: string
    userInitiated?: boolean
    uri?: string
    title?: string
    requestId?: string
    error?: string
  }
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

function navigateFromHost(path: string, token = 'test-generation', source = host.contentWindow) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source,
      origin: window.location.origin,
      data: { source: 'vibe-vscode', type: 'navigate', token, payload: { path } },
    })
  )
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  creation.create.mockResolvedValue({ id: 'created-chat', workspaceId: 'one' })
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

const selectionRequest = {
  requestId: '00000000-0000-4000-8000-000000000001',
  workspaceId: 'one',
  catalog: {
    physicalWorkspace: {
      id: 'physical-one',
      name: 'Projects',
      remoteAuthority: 'host.test',
      folders: [{ uri: 'vscode-remote://host.test/project', name: 'Project', index: 0 }],
    },
    logicalWorkspaces: [{ id: 'logical-one', name: 'One' }],
  },
  projectUri: 'vscode-remote://host.test/project',
  logicalWorkspaceId: 'logical-one',
  selection: {
    uri: 'vscode-remote://host.test/project/example.ts',
    language: 'typescript',
    text: 'const value = 1',
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 15 },
  },
}

function createFromHost(payload: unknown = selectionRequest, token = 'test-generation') {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: host.contentWindow,
      origin: window.location.origin,
      data: { source: 'vibe-vscode', token, type: 'createChat', payload },
    })
  )
}

describe('editor selection chat handoff', () => {
  it('creates once for repeated delivery and acknowledges the initiating request without navigating', async () => {
    let finish!: (value: { id: string; workspaceId: string }) => void
    creation.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    act(() => {
      createFromHost()
      createFromHost()
    })
    window.history.replaceState(null, '', '/workspace/two/d/another-plan')
    await act(async () => finish({ id: 'created-chat', workspaceId: 'one' }))
    expect(creation.create).toHaveBeenCalledExactlyOnceWith(
      selectionRequest,
      expect.any(AbortSignal)
    )
    expect(messages.filter((message) => message.type === 'chatCreated')).toEqual([
      {
        source: 'sim',
        token: 'test-generation',
        type: 'chatCreated',
        payload: {
          requestId: selectionRequest.requestId,
          path: '/workspace/one/chat/created-chat',
        },
      },
    ])
    expect(editorRequests()).toEqual([])
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('rejects invalid selections and obsolete bridge tokens before creating anything', () => {
    createFromHost(selectionRequest, 'obsolete')
    createFromHost({ ...selectionRequest, selection: { ...selectionRequest.selection, text: '' } })
    expect(creation.create).not.toHaveBeenCalled()
    expect(messages.filter((message) => message.type === 'chatCreated')).toMatchObject([
      { payload: { requestId: selectionRequest.requestId, error: expect.any(String) } },
    ])
  })

  it('returns creation failures for the host to display instead of silently losing the command', async () => {
    creation.create.mockRejectedValueOnce(new Error('Project was removed'))
    await act(async () => createFromHost())
    expect(messages.at(-1)).toMatchObject({
      type: 'chatCreated',
      payload: { requestId: selectionRequest.requestId, error: 'Project was removed' },
    })
  })
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
  it('uses the native client router without reconnecting or resetting sidebar scroll', () => {
    const bridge = window.vibeVscode
    navigateFromHost('/workspace/one/d/plan?view=overview')
    expect(router.replace).toHaveBeenCalledExactlyOnceWith(
      '/workspace/one/d/plan?view=overview&_vscodeSurface=sidebar',
      { scroll: false }
    )
    expect(window.vibeVscode).toBe(bridge)
    expect(messages.filter((message) => message.type === 'ready')).toHaveLength(1)
    expect(editorRequests()).toEqual([])

    /** The router commit remains a passive projection, not another native editor open. */
    window.history.replaceState(null, '', '/workspace/one/d/plan?view=overview')
    expect(messages.at(-1)).toMatchObject({
      type: 'routeChanged',
      payload: { path: '/workspace/one/d/plan?view=overview', userInitiated: false },
    })
  })

  it('forwards rapid tab selections in order for the native router to supersede old transitions', () => {
    navigateFromHost('/workspace/one/w/workflow')
    navigateFromHost('/workspace/one/chat/latest')
    expect(router.replace.mock.calls).toEqual([
      ['/workspace/one/w/workflow?_vscodeSurface=sidebar', { scroll: false }],
      ['/workspace/one/chat/latest?_vscodeSurface=sidebar', { scroll: false }],
    ])
    window.history.replaceState(null, '', '/workspace/one/chat/latest')
    expect(messages.at(-1)).toMatchObject({
      type: 'routeChanged',
      payload: { path: '/workspace/one/chat/latest', userInitiated: false },
    })
    expect(editorRequests()).toEqual([])
  })

  it('does not rebuild the bridge when the router hook returns a fresh wrapper', () => {
    const bridge = window.vibeVscode
    act(() => root.render(<VibeVscodeBridge />))
    expect(window.vibeVscode).toBe(bridge)
    expect(messages.filter((message) => message.type === 'ready')).toHaveLength(1)
  })

  it('rejects untrusted host navigation before reaching the router', () => {
    navigateFromHost('/workspace/one/chat/wrong-token', 'obsolete')
    navigateFromHost('/workspace/one/chat/wrong-window', 'test-generation', window)
    for (const path of ['//other.invalid', 'https://other.invalid', 'javascript:alert(1)']) {
      navigateFromHost(path)
    }
    expect(router.replace).not.toHaveBeenCalled()
  })

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
