/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockPlanFile {
  contentUpdatedAt: Date
  id: string
  key: string
  name: string
  updatedAt: Date
}

interface MockFilesQuery {
  data: MockPlanFile[]
  isLoading: boolean
}

interface MockContentQuery {
  data: string | undefined
  isLoading: boolean
}

const mocks = vi.hoisted(() => ({
  contentQuery: { data: undefined, isLoading: true } as MockContentQuery,
  createWorkspaceFile: vi.fn(),
  filesQuery: { data: [], isLoading: false } as MockFilesQuery,
  invalidateQueries: vi.fn(),
  toastError: vi.fn(),
  updateWorkspaceFileContent: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({ toast: { error: mocks.toastError } }))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('@/hooks/queries/workspace-files', () => ({
  useCreateWorkspaceFile: () => ({ mutate: mocks.createWorkspaceFile }),
  useUpdateWorkspaceFileContent: () => ({ mutateAsync: mocks.updateWorkspaceFileContent }),
  useWorkspaceFileContent: () => mocks.contentQuery,
  useWorkspaceFiles: () => mocks.filesQuery,
  workspaceFilesKeys: {
    workspaceLists: (workspaceId: string) => ['workspaceFiles', 'list', workspaceId],
  },
}))

import { usePersistedDag } from '@/app/plan-graph-demo/hooks/use-persisted-dag'
import {
  createDemoDag,
  getPlanFileName,
  serializeDagDocument,
} from '@/app/plan-graph-demo/plan-graph-model'

const DAG_ID = 'dag-loading-state-test'
const WORKSPACE_ID = 'workspace-1'

interface HookHarness {
  getResult: () => ReturnType<typeof usePersistedDag>
  rerender: () => void
  root: Root
}

function renderPersistedDag(): HookHarness {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let result: ReturnType<typeof usePersistedDag> | undefined

  function Probe() {
    result = usePersistedDag(WORKSPACE_ID, DAG_ID)
    return null
  }

  const rerender = () => {
    act(() => root.render(<Probe />))
  }

  rerender()

  return {
    getResult: () => {
      if (!result) throw new Error('Hook did not render')
      return result
    },
    rerender,
    root,
  }
}

describe('usePersistedDag loading state', () => {
  let harness: HookHarness | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    const now = new Date('2026-09-01T00:00:00.000Z')
    mocks.filesQuery.data = [
      {
        contentUpdatedAt: now,
        id: 'file-1',
        key: 'workspace/workspace-1/plan.json',
        name: getPlanFileName(DAG_ID),
        updatedAt: now,
      },
    ]
    mocks.filesQuery.isLoading = false
    mocks.contentQuery.data = undefined
    mocks.contentQuery.isLoading = true
  })

  afterEach(() => {
    if (harness) {
      act(() => harness?.root.unmount())
      harness = undefined
    }
    document.body.replaceChildren()
  })

  it('keeps the loaded DAG visible while a replacement storage key loads', () => {
    harness = renderPersistedDag()
    expect(harness.getResult().isLoading).toBe(true)

    mocks.contentQuery.data = serializeDagDocument(createDemoDag(DAG_ID))
    mocks.contentQuery.isLoading = false
    harness.rerender()

    expect(harness.getResult().dag).toBeDefined()
    expect(harness.getResult().isLoading).toBe(false)

    mocks.contentQuery.data = undefined
    mocks.contentQuery.isLoading = true
    harness.rerender()

    expect(harness.getResult().dag).toBeDefined()
    expect(harness.getResult().isLoading).toBe(false)
  })
})
