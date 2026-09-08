import { useEffect, useState } from 'react'
import type { VibeVscodeHostContext } from '@/lib/api/contracts/vscode-agents'

/** Page-local VS Code selection is UI context, not a Sim-owned workspace selection. */
export function useVscodeHostContext() {
  const [context, setContext] = useState<VibeVscodeHostContext>()
  useEffect(() => {
    const update = () => setContext(window.vibeVscode?.getContext())
    window.addEventListener('vibe-vscode-context', update)
    update()
    return () => window.removeEventListener('vibe-vscode-context', update)
  }, [])
  return context
}
