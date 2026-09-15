'use client'

import { useEffect } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n'
import {
  parseVibeVscodeSurface,
  publicVibeVscodePath,
  VIBE_VSCODE_EMBED_HASH_PREFIX,
  VIBE_VSCODE_SURFACE_PARAM,
  withVibeVscodeSurface,
} from '@/lib/vibe-vscode/surface'
import { type VibeVscodeHostContext, vscodeCreateChatRequestSchema } from '@/lib/vibe-vscode/types'
import { useCreateProjectSessionFromSelection } from '@/hooks/queries/vscode-agents'

const HOST_SOURCE = 'vibe-vscode'
const SIM_SOURCE = 'sim'
const TOKEN_STORAGE_KEY = 'vibe-vscode-bridge-token'

interface VibeVscodeBridgeApi {
  getContext: () => VibeVscodeHostContext | undefined
  getSurface: () => ReturnType<typeof parseVibeVscodeSurface>
  openEditor: (path: string) => void
  setEditorTitle: (path: string, title: string) => void
  openMonitor: () => void
  openFile: (uri: string, line?: number, character?: number) => void
  openDiff: (originalUri: string, modifiedUri: string, title?: string) => void
  openTerminal: (uri?: string) => void
  openExternal: (uri: string) => void
}

declare global {
  interface Window {
    vibeVscode?: VibeVscodeBridgeApi
    /** Installed before hydration only by the packaged VS Code Webview. */
    vibeVscodeTransport?: {
      readonly token: string
      postMessage(message: Record<string, unknown>): void
      onMessage(listener: (message: unknown) => void): () => void
    }
  }
}

interface HostBridgeMessage {
  source: typeof HOST_SOURCE
  token: string
  type: 'context' | 'navigate' | 'ping' | 'createChat'
  payload?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHostBridgeMessage(value: unknown, token: string): value is HostBridgeMessage {
  if (!isRecord(value)) return false
  return (
    value.source === HOST_SOURCE &&
    value.token === token &&
    (value.type === 'context' ||
      value.type === 'navigate' ||
      value.type === 'ping' ||
      value.type === 'createChat')
  )
}

function isHostContext(value: unknown): value is VibeVscodeHostContext {
  if (!isRecord(value) || typeof value.language !== 'string') return false
  if (value.physicalWorkspace !== undefined) {
    if (
      !isRecord(value.physicalWorkspace) ||
      typeof value.physicalWorkspace.id !== 'string' ||
      typeof value.physicalWorkspace.name !== 'string' ||
      typeof value.physicalWorkspace.remoteAuthority !== 'string' ||
      !Array.isArray(value.physicalWorkspace.folders) ||
      !value.physicalWorkspace.folders.every(
        (folder) =>
          isRecord(folder) &&
          typeof folder.name === 'string' &&
          typeof folder.uri === 'string' &&
          typeof folder.index === 'number'
      )
    ) {
      return false
    }
  }
  if (
    value.logicalWorkspaces !== undefined &&
    (!Array.isArray(value.logicalWorkspaces) ||
      !value.logicalWorkspaces.every(
        (item) => isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string'
      ))
  )
    return false
  if (
    value.logicalWorkspace !== undefined &&
    (!isRecord(value.logicalWorkspace) ||
      typeof value.logicalWorkspace.id !== 'string' ||
      typeof value.logicalWorkspace.name !== 'string')
  ) {
    return false
  }
  if (
    value.project !== undefined &&
    (!isRecord(value.project) ||
      typeof value.project.name !== 'string' ||
      typeof value.project.uri !== 'string')
  ) {
    return false
  }
  if (value.activeFile !== undefined) {
    if (!isRecord(value.activeFile) || typeof value.activeFile.uri !== 'string') return false
    if (
      value.activeFile.selection !== undefined &&
      (!isRecord(value.activeFile.selection) ||
        typeof value.activeFile.selection.startLine !== 'number' ||
        typeof value.activeFile.selection.startCharacter !== 'number' ||
        typeof value.activeFile.selection.endLine !== 'number' ||
        typeof value.activeFile.selection.endCharacter !== 'number')
    ) {
      return false
    }
  }
  return true
}

function readBridgeToken(surface: ReturnType<typeof parseVibeVscodeSurface>): string | undefined {
  const url = new URL(window.location.href)
  const storageKey = `${TOKEN_STORAGE_KEY}:${surface ?? 'default'}`
  let hashToken: string | undefined
  if (url.hash.startsWith(VIBE_VSCODE_EMBED_HASH_PREFIX)) {
    try {
      hashToken = decodeURIComponent(url.hash.slice(VIBE_VSCODE_EMBED_HASH_PREFIX.length)).trim()
    } catch {}
  }
  if (hashToken) {
    window.sessionStorage.setItem(storageKey, hashToken)
    return hashToken
  }
  return window.sessionStorage.getItem(storageKey)?.trim() || undefined
}

function isSafeNavigationPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

function toSameOriginNavigationPath(value: string): string | null {
  const url = new URL(value, window.location.href)
  if (
    (url.origin !== window.location.origin &&
      (!window.vibeVscodeTransport || url.origin !== new URL(document.baseURI).origin)) ||
    !/^\/(?:workspace(?:\/|$)|agents(?:\/|$))/.test(url.pathname)
  )
    return null
  return publicVibeVscodePath(url)
}

/** Connects the original Sim application surface to its trusted Vibe VS Code editor host. */
export function VibeVscodeBridge() {
  const { replace: replaceRoute } = useRouter()
  const { setLocale } = useI18n()
  const createFromSelection = useCreateProjectSessionFromSelection()

  useEffect(() => {
    const transport = window.vibeVscodeTransport
    if (!transport && window.parent === window) return
    const initialUrl = new URL(window.location.href)
    const surface = parseVibeVscodeSurface(initialUrl.searchParams.get(VIBE_VSCODE_SURFACE_PARAM))
    const token = transport?.token ?? readBridgeToken(surface)
    if (!token) return

    let hostContext: VibeVscodeHostContext | undefined
    let hostOrigin = '*'
    const lifecycle = new AbortController()
    const creating = new Map<string, string>()

    const postToHost = (type: string, payload?: Record<string, unknown>) => {
      const message = { source: SIM_SOURCE, token, type, payload }
      if (transport) transport.postMessage(message)
      else window.parent.postMessage(message, hostOrigin)
    }
    const publishRoute = (userInitiated = false) => {
      postToHost('routeChanged', {
        path: publicVibeVscodePath(new URL(window.location.href)),
        userInitiated,
      })
    }
    const preserveSurface = (url: string | URL | null | undefined) => {
      if (!surface || url === undefined || url === null) return url
      const target = new URL(url.toString(), window.location.href)
      if (target.origin !== window.location.origin) return url
      return withVibeVscodeSurface(`${target.pathname}${target.search}${target.hash}`, surface)
    }
    const clickListener = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('button, [role="button"]')) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (
        !anchor ||
        (anchor.target && anchor.target !== '_self') ||
        anchor.hasAttribute('download')
      )
        return
      const path = toSameOriginNavigationPath(anchor.href)
      if (!path) return

      /** Re-selecting the current row must also reveal a closed/background editor. */
      if (surface === 'sidebar' && path === publicVibeVscodePath(new URL(window.location.href))) {
        postToHost('openEditor', { path })
      }
      const embeddedHref = new URL(withVibeVscodeSurface(path, surface), window.location.origin)
      embeddedHref.hash = `${VIBE_VSCODE_EMBED_HASH_PREFIX.slice(1)}${encodeURIComponent(token)}`
      anchor.href = embeddedHref.toString()
    }
    /** Preserve native range selection, but keep new-tab/window resource actions in VS Code. */
    const newWindowListener = (event: MouseEvent) => {
      if (event.defaultPrevented || event.altKey || (event.button !== 0 && event.button !== 1))
        return
      const target = event.target
      if (!(target instanceof Element) || target.closest('button, [role="button"]')) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.hasAttribute('download')) return
      const opensWindow =
        event.button === 1 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (anchor.target && anchor.target !== '_self')
      const path = opensWindow ? toSameOriginNavigationPath(anchor.href) : null
      if (!path) return
      event.preventDefault()
      postToHost('openEditor', { path })
    }
    const receiveMessage = (message: unknown) => {
      if (!isHostBridgeMessage(message, token)) return
      if (message.type === 'context' && isHostContext(message.payload)) {
        hostContext = message.payload
        if (hostContext.language.toLowerCase().startsWith('zh')) setLocale('zh-CN')
        if (hostContext.language.toLowerCase().startsWith('en')) setLocale('en')
        window.dispatchEvent(
          new CustomEvent('vibe-vscode-context', { detail: structuredClone(hostContext) })
        )
        return
      }
      if (message.type === 'navigate' && isRecord(message.payload)) {
        const path = message.payload.path
        if (isSafeNavigationPath(path)) {
          /** Native tab selection preserves the sidebar layout, queries and scroll position. */
          replaceRoute(withVibeVscodeSurface(path, surface), { scroll: false })
        }
        return
      }
      if (message.type === 'createChat' && surface === 'sidebar') {
        const parsed = vscodeCreateChatRequestSchema.safeParse(message.payload)
        if (!parsed.success) {
          if (isRecord(message.payload) && typeof message.payload.requestId === 'string') {
            postToHost('chatCreated', {
              requestId: message.payload.requestId,
              error: '无法创建 Sim Chat：项目或文件选区上下文无效。',
            })
          }
          return
        }
        const request = parsed.data
        const fingerprint = JSON.stringify(request)
        const pending = creating.get(request.requestId)
        if (pending) {
          if (pending !== fingerprint) {
            postToHost('chatCreated', {
              requestId: request.requestId,
              error: '此创建请求已绑定到另一份上下文，请重新选择。',
            })
          }
          return
        }
        creating.set(request.requestId, fingerprint)
        const signal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(20_000)])
        void createFromSelection(request, signal)
          .then(
            (result) => {
              if (!lifecycle.signal.aborted) {
                postToHost('chatCreated', {
                  requestId: request.requestId,
                  path: `/workspace/${result.workspaceId}/chat/${result.id}`,
                })
              }
            },
            (error) => {
              if (!lifecycle.signal.aborted) {
                postToHost('chatCreated', {
                  requestId: request.requestId,
                  error: getErrorMessage(error, '无法创建 Sim Chat，请重试。'),
                })
              }
            }
          )
          .finally(() => creating.delete(request.requestId))
        return
      }
      if (message.type === 'ping') postToHost('ready', { path: window.location.pathname })
    }
    const messageListener = (event: MessageEvent<unknown>) => {
      if (transport || event.source !== window.parent) return
      hostOrigin = event.origin
      receiveMessage(event.data)
    }

    const originalPushState = window.history.pushState.bind(window.history)
    const originalReplaceState = window.history.replaceState.bind(window.history)
    const originalOpen = window.open.bind(window)
    window.history.pushState = (...args) => {
      const previousPathname = window.location.pathname
      originalPushState(args[0], args[1], preserveSurface(args[2]))
      /** Navigation commits carry intent, even when a slow server took longer than a click timer. */
      publishRoute(previousPathname !== window.location.pathname)
    }
    window.history.replaceState = (...args) => {
      originalReplaceState(args[0], args[1], preserveSurface(args[2]))
      publishRoute()
    }
    window.open = (url, target, features) => {
      const path = url ? toSameOriginNavigationPath(url.toString()) : null
      if (path) {
        postToHost('openEditor', { path })
        return null
      }
      return originalOpen(url, target, features)
    }
    const popStateListener = () => publishRoute(true)
    const hashChangeListener = () => publishRoute()

    window.vibeVscode = {
      getContext: () => (hostContext ? structuredClone(hostContext) : undefined),
      getSurface: () => surface,
      openEditor: (path) => {
        if (isSafeNavigationPath(path)) postToHost('openEditor', { path })
      },
      setEditorTitle: (path, title) => {
        if (isSafeNavigationPath(path) && title.trim()) {
          postToHost('titleChanged', { path, title })
        }
      },
      openMonitor: () => postToHost('openMonitor'),
      openFile: (uri, line, character) => postToHost('openFile', { uri, line, character }),
      openDiff: (originalUri, modifiedUri, title) =>
        postToHost('openDiff', { originalUri, modifiedUri, title }),
      openTerminal: (uri) => postToHost('openTerminal', { uri }),
      openExternal: (uri) => {
        const path = toSameOriginNavigationPath(uri)
        if (path) postToHost('openEditor', { path })
        else postToHost('openExternal', { uri })
      },
    }
    window.addEventListener('message', messageListener)
    const removeTransportListener = transport?.onMessage(receiveMessage)
    window.addEventListener('click', clickListener, true)
    window.addEventListener('click', newWindowListener)
    window.addEventListener('auxclick', newWindowListener)
    window.addEventListener('popstate', popStateListener)
    window.addEventListener('hashchange', hashChangeListener)
    postToHost('ready', {
      path: window.location.pathname,
      capabilities: [
        'context',
        'openEditor',
        'openFile',
        'openDiff',
        'openTerminal',
        'openExternal',
      ],
    })
    publishRoute()
    /** Consumers may publish metadata as soon as they observe the bridge. Admit it first. */
    window.dispatchEvent(new Event('vibe-vscode-context'))

    return () => {
      lifecycle.abort()
      window.removeEventListener('message', messageListener)
      removeTransportListener?.()
      window.removeEventListener('click', clickListener, true)
      window.removeEventListener('click', newWindowListener)
      window.removeEventListener('auxclick', newWindowListener)
      window.removeEventListener('popstate', popStateListener)
      window.removeEventListener('hashchange', hashChangeListener)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
      window.open = originalOpen
      window.vibeVscode = undefined
      window.dispatchEvent(new Event('vibe-vscode-context'))
    }
  }, [replaceRoute, setLocale, createFromSelection])

  return null
}
