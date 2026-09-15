/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DagDocument } from '@/lib/dags/model'

const mocks = vi.hoisted(() => ({
  documents: new Map<string, DagDocument>(),
  draft: undefined as DagDocument | undefined,
  lists: new Map<
    string,
    { dags: { id: string; name: string; repository: string; revision: number }[] }
  >(),
  error: null as Error | null,
  loading: false,
  update: vi.fn(),
}))
vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: ReactNode }) => children,
  ChipConfirmModal: () => null,
  cn: (...values: string[]) => values.join(' '),
  toast: { error: vi.fn() },
}))
vi.mock('@sim/emcn/icons', () => ({ Split: () => null, Trash: () => null }))
vi.mock('reactflow', () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/canvas', () => ({
  CanvasEditorFrame: ({
    children,
    bottomPanel,
  }: {
    children: ReactNode
    bottomPanel: ReactNode
  }) => (
    <>
      {children}
      {bottomPanel}
    </>
  ),
}))
vi.mock('@/app/workspace/[workspaceId]/d/[dagId]/components', () => ({
  ActivityPanel: ({ document }: { document: DagDocument }) => (
    <div data-activity-name={document.name} />
  ),
  DagCanvasAdapter: ({ selectedItemId }: { selectedItemId: string }) => (
    <div data-selected={selectedItemId} />
  ),
  NodeInspector: () => null,
  PlanHeader: ({ name }: { name: string }) => <h1>{name}</h1>,
}))
vi.mock('@/app/workspace/[workspaceId]/d/[dagId]/hooks/use-persisted-dag', () => ({
  usePersistedDag: (workspaceId: string, dagId: string) => ({
    dag: mocks.draft ?? mocks.documents.get(JSON.stringify([workspaceId, dagId])),
    persistedDag: mocks.documents.get(JSON.stringify([workspaceId, dagId])),
    error: mocks.error?.message,
    isLoading: mocks.loading,
    isSaving: false,
    isMissing: !mocks.loading && !mocks.documents.has(JSON.stringify([workspaceId, dagId])),
    updateDag: mocks.update,
  }),
}))
vi.mock('@/hooks/queries/dags', () => ({
  useReconcileDagWithGitHub: () => ({ isPending: false }),
  useDags: (workspaceId: string) => ({
    data: mocks.lists.get(workspaceId),
    isPending: mocks.loading,
    isError: Boolean(mocks.error),
    error: mocks.error,
  }),
}))
vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/hooks', () => ({
  useHoverMenu: () => ({}),
}))
vi.mock('@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-nav-chip', () => ({
  SidebarNavChip: ({ item }: { item: { href: string; label: string } }) => (
    <a href={item.href}>{item.label}</a>
  ),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu',
  () => ({
    CollapsedSidebarMenu: ({ children }: { children: ReactNode }) => children,
    CollapsedResourceFlyout: ({
      entries,
      emptyLabel,
    }: {
      entries: { href: string; name: string }[]
      emptyLabel: string
    }) =>
      entries.length ? (
        <>
          {entries.map((entry) => (
            <a key={entry.href} href={entry.href}>
              {entry.name}
            </a>
          ))}
        </>
      ) : (
        <p>{emptyLabel}</p>
      ),
  })
)

import { createTestDag } from '@/lib/dags/model.test-fixtures'
import { DagEditor } from '@/app/workspace/[workspaceId]/d/[dagId]/dag'
import DagPage from '@/app/workspace/[workspaceId]/d/[dagId]/page'
import { DagList } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/dag-list/dag-list'

const WORKSPACE_ID = 'workspace-1'
const DAG_ID = 'database-only-dag'
const CUSTOM_NAME = 'vscode x sim agent工作台'
let container: HTMLDivElement
let root: Root

function setDocument(name: string, revision = 2) {
  const dag = { ...createTestDag(DAG_ID), name, revision }
  mocks.documents.set(JSON.stringify([WORKSPACE_ID, DAG_ID]), dag)
  mocks.lists.set(WORKSPACE_ID, { dags: [dag] })
}

function renderSurfaces(isCollapsed: boolean, workspaceId = WORKSPACE_ID) {
  act(() =>
    root.render(
      <>
        <DagList currentDagId={DAG_ID} isCollapsed={isCollapsed} workspaceId={workspaceId} />
        <DagEditor workspaceId={workspaceId} dagId={DAG_ID} />
      </>
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.documents.clear()
  mocks.draft = undefined
  mocks.lists.clear()
  mocks.loading = false
  mocks.error = null
  setDocument(CUSTOM_NAME)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('database-backed DAG surfaces', () => {
  it.each([false, true])(
    'renders the persisted name in both surfaces (collapsed: %s)',
    (collapsed) => {
      renderSurfaces(collapsed)
      expect(container.querySelector('h1')?.textContent).toBe(CUSTOM_NAME)
      expect(container.querySelector('a')?.textContent).toBe(CUSTOM_NAME)
      expect(container.querySelector('a')?.getAttribute('href')).toBe(
        `/workspace/${WORKSPACE_ID}/d/${DAG_ID}`
      )
      expect(mocks.update).not.toHaveBeenCalled()
      expect(container.textContent).not.toContain('Sim self-hosting roadmap')
    }
  )
  it('updates both surfaces when the stored name changes', () => {
    renderSurfaces(false)
    setDocument('下一轮协作', 3)
    renderSurfaces(false)
    expect(container.querySelector('h1')?.textContent).toBe('下一轮协作')
    expect(container.querySelector('a')?.textContent).toBe('下一轮协作')
  })
  it('projects recorded activities from the saved document, not an uncommitted draft', () => {
    mocks.draft = { ...createTestDag(DAG_ID), name: 'Uncommitted edit' }
    renderSurfaces(false)
    expect(container.querySelector('h1')?.textContent).toBe('Uncommitted edit')
    expect(
      container.querySelector('[data-activity-name]')?.getAttribute('data-activity-name')
    ).toBe(CUSTOM_NAME)
  })
  it.each([false, true])(
    'discovers additional persisted DAGs without a source registry (collapsed: %s)',
    (collapsed) => {
      const list = mocks.lists.get(WORKSPACE_ID)
      list?.dags.push({
        id: 'a-new-dag',
        name: 'Another graph',
        repository: 'example/another',
        revision: 8,
      })
      renderSurfaces(collapsed)
      expect([...container.querySelectorAll('a')].map((a) => a.textContent)).toEqual([
        CUSTOM_NAME,
        'Another graph',
      ])
    }
  )
  it('does not carry the old workspace list or document into a new workspace', () => {
    renderSurfaces(false)
    mocks.loading = true
    renderSurfaces(false, 'workspace-2')
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('h1')).toBeNull()
    expect(container.textContent).not.toContain(CUSTOM_NAME)
  })
  it.each([false, true])(
    'has an empty list and a missing-document state without seeding (collapsed: %s)',
    (collapsed) => {
      mocks.lists.set(WORKSPACE_ID, { dags: [] })
      mocks.documents.clear()
      renderSurfaces(collapsed)
      expect(container.querySelector('a')).toBeNull()
      expect(container.textContent).toContain('sidebar.noDags')
      expect(container.textContent).toContain('plan.notFound')
      expect(mocks.update).not.toHaveBeenCalled()
    }
  )
  it('reports listing errors instead of fabricating a default entry', () => {
    mocks.error = new Error('Database unavailable')
    renderSurfaces(false)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[role=alert]')?.textContent).toBe('Database unavailable')
  })
  it('derives the initial selection from the stored nodes, not PG-01', () => {
    const dag = mocks.documents.get(JSON.stringify([WORKSPACE_ID, DAG_ID]))
    if (!dag) throw new Error('Missing fixture')
    dag.items = [{ ...dag.items[0], id: 'custom-first-node' }]
    dag.dependencies = []
    renderSurfaces(false)
    expect(container.querySelector('[data-selected]')?.getAttribute('data-selected')).toBe(
      'custom-first-node'
    )
  })
  it('allows the dynamic page to open a DAG not registered in source', async () => {
    const page = await DagPage({
      params: Promise.resolve({ workspaceId: WORKSPACE_ID, dagId: DAG_ID }),
    })
    act(() => root.render(page))
    expect(container.querySelector('h1')?.textContent).toBe(CUSTOM_NAME)
  })
  it('renders hostile stored names as text', () => {
    setDocument('<img src=x onerror=alert(1)>')
    renderSurfaces(false)
    expect(container.querySelector('h1')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(container.querySelector('img')).toBeNull()
  })
})
