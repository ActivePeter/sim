export const VIBE_VSCODE_SURFACE_PARAM = '_vscodeSurface'

export type VibeVscodeSurface = 'editor' | 'sidebar'

export function parseVibeVscodeSurface(value: unknown): VibeVscodeSurface | null {
  return value === 'editor' || value === 'sidebar' ? value : null
}

/** Adds the trusted host projection to an origin-relative Sim route. */
export function withVibeVscodeSurface(path: string, surface: VibeVscodeSurface | null): string {
  if (!surface) return path

  const url = new URL(path, 'https://sim.local')
  url.searchParams.set(VIBE_VSCODE_SURFACE_PARAM, surface)
  return `${url.pathname}${url.search}${url.hash}`
}

/** Removes host-only projection state before a route is sent back to VS Code. */
export function publicVibeVscodePath(url: URL): string {
  const route = new URL(url)
  route.searchParams.delete(VIBE_VSCODE_SURFACE_PARAM)
  if (route.hash.startsWith('#_vscodeEmbed=')) route.hash = ''
  return `${route.pathname}${route.search}${route.hash}`
}
