import { useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { parseVibeVscodeSurface, VIBE_VSCODE_SURFACE_PARAM } from '@/lib/vibe-vscode/surface'

function subscribe(listener: () => void) {
  window.addEventListener('vibe-vscode-context', listener)
  return () => window.removeEventListener('vibe-vscode-context', listener)
}

const getSnapshot = () => window.vibeVscode?.getSurface()
const getServerSnapshot = () => undefined

/** A mounted host surface is bridge identity, not mutable Next router search state. */
export function useVscodeSurface() {
  const searchParams = useSearchParams()
  const surface = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return surface === undefined
    ? parseVibeVscodeSurface(searchParams.get(VIBE_VSCODE_SURFACE_PARAM))
    : surface
}
