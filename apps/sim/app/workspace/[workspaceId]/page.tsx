import { redirect } from 'next/navigation'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import {
  parseVibeVscodeSurface,
  VIBE_VSCODE_SURFACE_PARAM,
  withVibeVscodeSurface,
} from '@/lib/vibe-vscode/surface'

/**
 * Resolves the workspace landing route: the chat composer, or `/w`, which
 * selects the first workflow from the list the layout already prefetched.
 *
 * Deliberately does no work of its own. Resolving the workflow here would mean
 * a session lookup, an access check, and a query before anything renders — and
 * a slow database would leave the user on a blank page instead of a redirect,
 * since there is nothing to show until all three finish.
 */
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { workspaceId } = await params
  const query = await searchParams
  const rawSurface = query[VIBE_VSCODE_SURFACE_PARAM]
  const surface = parseVibeVscodeSurface(Array.isArray(rawSurface) ? rawSurface[0] : rawSurface)
  redirect(
    withVibeVscodeSurface(`/workspace/${workspaceId}/${isChatEnabled ? 'home' : 'w'}`, surface)
  )
}
