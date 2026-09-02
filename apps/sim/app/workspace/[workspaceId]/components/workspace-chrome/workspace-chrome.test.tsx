/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome/workspace-chrome'

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1',
  useSearchParams: () => navigation.searchParams,
}))

vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/sidebar', () => ({
  Sidebar: ({ fixedExpanded, isPeeking }: { fixedExpanded?: boolean; isPeeking?: boolean }) => (
    <div
      data-testid='sidebar'
      data-fixed-expanded={fixedExpanded || undefined}
      data-peeking={isPeeking || undefined}
    />
  ),
  SidebarTooltip: ({ children }: { children: React.ReactNode }) => children,
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  navigation.searchParams = new URLSearchParams('_vscodeSurface=sidebar')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WorkspaceChrome host surfaces', () => {
  it('projects only a fixed sidebar that fills the host container', () => {
    act(() => {
      root.render(
        <WorkspaceChrome>
          <div data-testid='canvas'>canvas</div>
        </WorkspaceChrome>
      )
    })

    const sidebar = container.querySelector<HTMLElement>('[data-testid="sidebar"]')
    const host = sidebar?.parentElement

    expect(sidebar?.dataset.fixedExpanded).toBe('true')
    expect(sidebar?.dataset.peeking).toBeUndefined()
    expect(host?.classList).toContain('flex')
    expect(host?.classList).toContain('w-full')
    expect(host?.classList).toContain('overflow-hidden')
    expect(container.querySelector('[data-testid="canvas"]')).toBeNull()
  })
})
