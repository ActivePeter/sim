import { useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseVibeVscodeSurface, VIBE_VSCODE_SURFACE_PARAM } from '@/lib/vibe-vscode/surface'

function subscribe(listener: () => void) {
  window.addEventListener('vibe-vscode-context', listener)
  return () => window.removeEventListener('vibe-vscode-context', listener)
}

const getSnapshot = () => window.vibeVscode?.getSurface()
const getServerSnapshot = () => undefined
const getEmbeddedSnapshot = () => window.vibeVscode !== undefined
const getServerEmbeddedSnapshot = () => false

/** Fullscreen is embedded too, even after its initial fragment leaves the route. */
export function useVscodeEmbedded() {
  const mounted = useSyncExternalStore(subscribe, getEmbeddedSnapshot, getServerEmbeddedSnapshot)
  const searchParams = useSearchParams()
  return mounted || parseVibeVscodeSurface(searchParams.get(VIBE_VSCODE_SURFACE_PARAM)) !== null
}

/** A mounted host surface is bridge identity, not mutable Next router search state. */
export function useVscodeSurface() {
  const searchParams = useSearchParams()
  const surface = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return surface === undefined
    ? parseVibeVscodeSurface(searchParams.get(VIBE_VSCODE_SURFACE_PARAM))
    : surface
}
