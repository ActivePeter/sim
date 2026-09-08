import { redirect } from 'next/navigation'
import {
  parseVibeVscodeSurface,
  VIBE_VSCODE_SURFACE_PARAM,
  withVibeVscodeSurface,
} from '@/lib/vibe-vscode/surface'

interface AgentsEntryProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AgentsEntry({ searchParams }: AgentsEntryProps) {
  const params = await searchParams
  redirect(
    withVibeVscodeSurface(
      '/workspace?redirect=agents',
      parseVibeVscodeSurface(params[VIBE_VSCODE_SURFACE_PARAM])
    )
  )
}
