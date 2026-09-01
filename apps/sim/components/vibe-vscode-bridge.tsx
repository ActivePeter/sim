'use client'

import { useEffect } from 'react'
import { useI18n } from '@/lib/i18n'

const HOST_SOURCE = 'vibe-vscode'
const SIM_SOURCE = 'sim'
const TOKEN_HASH_PREFIX = '#_vscodeEmbed='
const TOKEN_STORAGE_KEY = 'vibe-vscode-bridge-token'

interface VibeVscodeSelection {
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
}

interface VibeVscodeHostContext {
  language: string
  workspaceFolders: readonly { name: string; uri: string }[]
  activeFile?: { uri: string; selection: VibeVscodeSelection }
}

interface VibeVscodeBridgeApi {
  getContext: () => VibeVscodeHostContext | undefined
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
  if (!Array.isArray(value.workspaceFolders)) return false
  return value.workspaceFolders.every(
    (folder) =>
      isRecord(folder) && typeof folder.name === 'string' && typeof folder.uri === 'string'
  )
}

function readBridgeToken(): string | undefined {
  const url = new URL(window.location.href)
  let hashToken: string | undefined
  if (url.hash.startsWith(TOKEN_HASH_PREFIX)) {
    try {
      hashToken = decodeURIComponent(url.hash.slice(TOKEN_HASH_PREFIX.length)).trim()
    } catch {}
  }
  if (hashToken) {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, hashToken)
    return hashToken
  }
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() || undefined
}

function isSafeNavigationPath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
}

/** Connects the original Sim application surface to its trusted Vibe VS Code editor host. */
export function VibeVscodeBridge() {
  const { setLocale } = useI18n()

  useEffect(() => {
    if (window.parent === window) return
    const token = readBridgeToken()
    if (!token) return

    let hostContext: VibeVscodeHostContext | undefined
    let hostOrigin = '*'

    const postToHost = (type: string, payload?: Record<string, unknown>) => {
      window.parent.postMessage({ source: SIM_SOURCE, token, type, payload }, hostOrigin)
    }
    const publishRoute = () => {
      const route = new URL(window.location.href)
      if (route.hash.startsWith(TOKEN_HASH_PREFIX)) route.hash = ''
      postToHost('routeChanged', {
        path: `${route.pathname}${route.search}${route.hash}`,
      })
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
        if (isSafeNavigationPath(path)) window.location.assign(path)
        return
      }
      if (event.data.type === 'ping') postToHost('ready', { path: window.location.pathname })
    }

    const originalPushState = window.history.pushState.bind(window.history)
    const originalReplaceState = window.history.replaceState.bind(window.history)
    window.history.pushState = (...args) => {
      originalPushState(...args)
      publishRoute()
    }
    window.history.replaceState = (...args) => {
      originalReplaceState(...args)
      publishRoute()
    }

    window.vibeVscode = {
      getContext: () => (hostContext ? structuredClone(hostContext) : undefined),
      openFile: (uri, line, character) => postToHost('openFile', { uri, line, character }),
      openDiff: (originalUri, modifiedUri, title) =>
        postToHost('openDiff', { originalUri, modifiedUri, title }),
      openTerminal: (uri) => postToHost('openTerminal', { uri }),
      openExternal: (uri) => postToHost('openExternal', { uri }),
    }

    window.addEventListener('message', messageListener)
    window.addEventListener('popstate', publishRoute)
    window.addEventListener('hashchange', publishRoute)
    postToHost('ready', {
      path: window.location.pathname,
      capabilities: ['context', 'openFile', 'openDiff', 'openTerminal', 'openExternal'],
    })
    publishRoute()

    return () => {
      window.removeEventListener('message', messageListener)
      window.removeEventListener('popstate', publishRoute)
      window.removeEventListener('hashchange', publishRoute)
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
      window.vibeVscode = undefined
    }
  }, [setLocale])

  return null
}
