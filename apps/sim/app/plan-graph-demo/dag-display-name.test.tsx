/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  content: undefined as string | undefined,
  files: [] as { id: string; key: string; name: string; workspaceId: string }[],
  placeholder: false,
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: ReactNode }) => children,
  ChipConfirmModal: () => null,
  cn: (...values: string[]) => values.join(' '),
  toast: { error: vi.fn() },
}))
vi.mock('@sim/emcn/icons', () => ({ Split: () => null, Trash: () => null }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('reactflow', () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => (key === 'plan.demo.name' ? 'Sim self-hosting roadmap' : key),
  }),
}))
vi.mock('@/components/canvas', () => ({ CanvasEditorFrame: () => null }))
vi.mock('@/app/plan-graph-demo/components', () => ({
  ActivityPanel: () => null,
  DagCanvasAdapter: () => null,
  NodeInspector: () => null,
  PlanHeader: ({ name }: { name: string }) => <h1>{name}</h1>,
}))
vi.mock('@/app/plan-graph-demo/hooks/use-github-reconciliation', () => ({
  useGitHubReconciliation: () => ({ isPending: false }),
}))
vi.mock('@/hooks/queries/workspace-files', () => ({
  useWorkspaceFiles: () => ({
    data: mocks.files,
    isSuccess: true,
    isLoading: false,
    isPlaceholderData: mocks.placeholder,
    error: null,
  }),
  useWorkspaceFileContent: () => ({ data: mocks.content, isLoading: false, error: null }),
  useCreateWorkspaceFile: () => ({ mutate: mocks.create }),
  useUpdateWorkspaceFileContent: () => ({ mutateAsync: mocks.update }),
  workspaceFilesKeys: { workspaceLists: (workspaceId: string) => ['workspaceFiles', workspaceId] },
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
    CollapsedResourceFlyout: ({ entries }: { entries: { href: string; name: string }[] }) => (
      <>
        {entries.map((entry) => (
          <a key={entry.href} href={entry.href}>
            {entry.name}
          </a>
        ))}
      </>
    ),
  })
)

import { DEFAULT_DEMO_DAG_ID } from '@/lib/dags/demo-catalog'
import { DagDemo } from '@/app/plan-graph-demo/plan-graph-demo'
import {
  createDemoDag,
  getPlanFileName,
  serializeDagDocument,
} from '@/app/plan-graph-demo/plan-graph-model'
import { DagList } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/dag-list/dag-list'

const WORKSPACE_ID = 'workspace-1'
const CUSTOM_NAME = 'vscode x sim agent工作台'
let container: HTMLDivElement
let root: Root

function setDocumentName(name: string, revision = 2) {
  mocks.content = serializeDagDocument({ ...createDemoDag(), name, revision })
}

function renderSurfaces(isCollapsed: boolean, workspaceId = WORKSPACE_ID, includeEditor = true) {
  act(() =>
    root.render(
      <>
        <DagList
          currentDagId={DEFAULT_DEMO_DAG_ID}
          isCollapsed={isCollapsed}
          workspaceId={workspaceId}
        />
        {includeEditor && <DagDemo workspaceId={workspaceId} />}
      </>
    )
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.placeholder = false
  mocks.files = [
    {
      id: 'file-1',
      key: 'workspace/workspace-1/plan.json',
      name: getPlanFileName(DEFAULT_DEMO_DAG_ID),
      workspaceId: WORKSPACE_ID,
    },
  ]
  setDocumentName(CUSTOM_NAME)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('DAG document display name', () => {
  it.each([false, true])(
    'uses the persisted name in the header and sidebar (collapsed: %s)',
    (collapsed) => {
      renderSurfaces(collapsed)

      expect({
        header: container.querySelector('h1')?.textContent,
        navigation: container.querySelector('a')?.textContent,
        creates: mocks.create.mock.calls.length,
        writes: mocks.update.mock.calls.length,
      }).toEqual({ header: CUSTOM_NAME, navigation: CUSTOM_NAME, creates: 0, writes: 0 })
      expect(container.textContent).not.toContain('Sim self-hosting roadmap')
    }
  )

  it('updates both surfaces when the persisted name changes', () => {
    renderSurfaces(false)
    setDocumentName('下一轮协作', 3)
    renderSurfaces(false)

    expect({
      header: container.querySelector('h1')?.textContent,
      navigation: container.querySelector('a')?.textContent,
    }).toEqual({ header: '下一轮协作', navigation: '下一轮协作' })
  })

  it('does not display the previous workspace document while its listing is a placeholder', () => {
    renderSurfaces(false, WORKSPACE_ID, false)
    mocks.placeholder = true
    renderSurfaces(false, 'workspace-2', false)

    expect(container.querySelector('a')?.textContent).toBe('plan.loading')
    expect(container.textContent).not.toContain(CUSTOM_NAME)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('does not create a missing DAG merely by rendering sidebar navigation', () => {
    mocks.files = []
    mocks.content = undefined
    renderSurfaces(false, WORKSPACE_ID, false)

    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('does not use a name from a document with a mismatched DAG identity', () => {
    mocks.content = serializeDagDocument({ ...createDemoDag('other-dag'), name: 'Other graph' })
    renderSurfaces(false, WORKSPACE_ID, false)

    expect(container.querySelector('a')?.textContent).toBe('plan.loading')
    expect(container.textContent).not.toContain('Other graph')
  })
})
