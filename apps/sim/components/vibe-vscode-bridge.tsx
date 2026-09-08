'use client'

import { useEffect } from 'react'
import { useI18n } from '@/lib/i18n'
import {
  parseVibeVscodeSurface,
  publicVibeVscodePath,
  VIBE_VSCODE_EMBED_HASH_PREFIX,
  VIBE_VSCODE_SURFACE_PARAM,
  withVibeVscodeSurface,
} from '@/lib/vibe-vscode/surface'
import type { VibeVscodeHostContext } from '@/lib/vibe-vscode/types'

const HOST_SOURCE = 'vibe-vscode'
const SIM_SOURCE = 'sim'
const TOKEN_STORAGE_KEY = 'vibe-vscode-bridge-token'

interface VibeVscodeBridgeApi {
  getContext: () => VibeVscodeHostContext | undefined
  getSurface: () => ReturnType<typeof parseVibeVscodeSurface>
  openEditor: (path: string) => void
  openMonitor: () => void
  openFile: (uri: string, line?: number, character?: number) => void
  openDiff: (originalUri: string, modifiedUri: string, title?: string) => void
  openTerminal: (uri?: string) => void
  openExternal: (uri: string) => void
}

declare global {
  interface Window {
    vibeVscode?: VibeVscodeBridgeApi
  }
}

interface HostBridgeMessage {
  source: typeof HOST_SOURCE
  token: string
  type: 'context' | 'navigate' | 'ping'
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
    (value.type === 'context' || value.type === 'navigate' || value.type === 'ping')
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
  if (url.origin !== window.location.origin || !isSafeNavigationPath(url.pathname)) return null
  return publicVibeVscodePath(url)
}

/** Connects the original Sim application surface to its trusted Vibe VS Code editor host. */
export function VibeVscodeBridge() {
  const { setLocale } = useI18n()

  useEffect(() => {
    if (window.parent === window) return
    const initialUrl = new URL(window.location.href)
    const surface = parseVibeVscodeSurface(initialUrl.searchParams.get(VIBE_VSCODE_SURFACE_PARAM))
    const token = readBridgeToken(surface)
    if (!token) return

    let hostContext: VibeVscodeHostContext | undefined
    let hostOrigin = '*'

    const postToHost = (type: string, payload?: Record<string, unknown>) => {
      window.parent.postMessage({ source: SIM_SOURCE, token, type, payload }, hostOrigin)
    }
    const publishRoute = () => {
      postToHost('routeChanged', {
        path: publicVibeVscodePath(new URL(window.location.href)),
        userInitiated: Date.now() <= userNavigationDeadline,
      })
    }
    const preserveSurface = (url: string | URL | null | undefined) => {
      if (!surface || url === undefined || url === null) return url
      const target = new URL(url.toString(), window.location.href)
      if (target.origin !== window.location.origin) return url
      return withVibeVscodeSurface(`${target.pathname}${target.search}${target.hash}`, surface)
    }
    let userNavigationDeadline = 0
    const clickListener = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (surface === 'sidebar') userNavigationDeadline = Date.now() + 1000
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const path = toSameOriginNavigationPath(anchor.href)
      if (!path) return

      const embeddedHref = new URL(withVibeVscodeSurface(path, surface), window.location.origin)
      embeddedHref.hash = `${VIBE_VSCODE_EMBED_HASH_PREFIX.slice(1)}${encodeURIComponent(token)}`
      anchor.href = embeddedHref.toString()
    }
    const messageListener = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || !isHostBridgeMessage(event.data, token)) return
      hostOrigin = event.origin
      if (event.data.type === 'context' && isHostContext(event.data.payload)) {
        hostContext = event.data.payload
        if (hostContext.language.toLowerCase().startsWith('zh')) setLocale('zh-CN')
        if (hostContext.language.toLowerCase().startsWith('en')) setLocale('en')
        window.dispatchEvent(
          new CustomEvent('vibe-vscode-context', { detail: structuredClone(hostContext) })
        )
        return
      }
      if (event.data.type === 'navigate' && isRecord(event.data.payload)) {
        const path = event.data.payload.path
        if (isSafeNavigationPath(path)) {
          window.location.assign(withVibeVscodeSurface(path, surface))
        }
        return
      }
      if (event.data.type === 'ping') postToHost('ready', { path: window.location.pathname })
    }

    const originalPushState = window.history.pushState.bind(window.history)
    const originalReplaceState = window.history.replaceState.bind(window.history)
    window.history.pushState = (...args) => {
      originalPushState(args[0], args[1], preserveSurface(args[2]))
      publishRoute()
    }
    window.history.replaceState = (...args) => {
      originalReplaceState(args[0], args[1], preserveSurface(args[2]))
      publishRoute()
    }

    window.vibeVscode = {
      getContext: () => (hostContext ? structuredClone(hostContext) : undefined),
      getSurface: () => surface,
      openEditor: (path) => {
        if (isSafeNavigationPath(path)) postToHost('openEditor', { path })
      },
      openMonitor: () => postToHost('openMonitor'),
      openFile: (uri, line, character) => postToHost('openFile', { uri, line, character }),
      openDiff: (originalUri, modifiedUri, title) =>
        postToHost('openDiff', { originalUri, modifiedUri, title }),
      openTerminal: (uri) => postToHost('openTerminal', { uri }),
      openExternal: (uri) => postToHost('openExternal', { uri }),
    }
    window.dispatchEvent(new Event('vibe-vscode-context'))

    window.addEventListener('message', messageListener)
    window.addEventListener('click', clickListener, true)
    window.addEventListener('popstate', publishRoute)
    window.addEventListener('hashchange', publishRoute)
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

    return () => {
      window.removeEventListener('message', messageListener)
      window.removeEventListener('click', clickListener, true)
      window.removeEventListener('popstate', publishRoute)
      window.removeEventListener('hashchange', publishRoute)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
      window.vibeVscode = undefined
      window.dispatchEvent(new Event('vibe-vscode-context'))
    }
  }, [setLocale])

  return null
}
