/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  params: { workspaceId: 'workspace-1' } as {
    workspaceId: string
    workflowId?: string
    dagId?: string
    chatId?: string
  },
  workflows: {} as Record<string, { name: string }>,
  dag: undefined as { name: string } | undefined,
  chats: [] as { id: string; name: string }[],
  placeholder: false,
}))

vi.mock('next/navigation', () => ({ useParams: () => state.params }))
vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflowMap: () => ({ data: state.workflows, isPlaceholderData: state.placeholder }),
}))
vi.mock('@/hooks/queries/dags', () => ({
  useDag: () => ({ data: state.dag ? { dag: state.dag } : undefined }),
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useMothershipChats: () => ({ data: state.chats, isPlaceholderData: state.placeholder }),
}))

import { VscodeEditorTitle } from '@/app/workspace/[workspaceId]/components/workspace-chrome/vscode-editor-title'

let container: HTMLDivElement
let root: Root
const setEditorTitle = vi.fn()
const createBridge = (): NonNullable<Window['vibeVscode']> => ({
  getContext: () => undefined,
  getSurface: () => 'editor',
  openEditor: vi.fn(),
  setEditorTitle,
  openMonitor: vi.fn(),
  openFile: vi.fn(),
  openDiff: vi.fn(),
  openTerminal: vi.fn(),
  openExternal: vi.fn(),
})

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  state.params = { workspaceId: 'workspace-1' }
  state.workflows = {}
  state.dag = undefined
  state.chats = []
  state.placeholder = false
  window.vibeVscode = createBridge()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.vibeVscode = undefined
})

describe('VS Code editor title projection', () => {
  it('uses native query names and explicit workspace/resource identities for all resource kinds', () => {
    state.workflows = { workflow: { name: 'Database workflow' } }
    state.dag = { name: 'Database DAG' }
    state.chats = [{ id: 'chat', name: 'Database session' }]
    for (const params of [{ workflowId: 'workflow' }, { dagId: 'plan' }, { chatId: 'chat' }]) {
      state.params = { workspaceId: 'workspace-1', ...params }
      act(() => root.render(<VscodeEditorTitle />))
    }
    expect(setEditorTitle.mock.calls).toEqual([
      ['/workspace/workspace-1/w/workflow', 'Database workflow'],
      ['/workspace/workspace-1/d/plan', 'Database DAG'],
      ['/workspace/workspace-1/chat/chat', 'Database session'],
    ])
  })

  it('publishes a rename without navigating or changing the resource identity', () => {
    state.params = { workspaceId: 'workspace-1', chatId: 'chat' }
    state.chats = [{ id: 'chat', name: 'Original title' }]
    act(() => root.render(<VscodeEditorTitle />))
    state.chats = [{ id: 'chat', name: 'Renamed title' }]
    act(() => root.render(<VscodeEditorTitle />))
    expect(setEditorTitle.mock.calls).toEqual([
      ['/workspace/workspace-1/chat/chat', 'Original title'],
      ['/workspace/workspace-1/chat/chat', 'Renamed title'],
    ])
    expect(window.vibeVscode?.openEditor).not.toHaveBeenCalled()
  })

  it('does not publish previous-workspace placeholders or invented names while loading', () => {
    state.params = { workspaceId: 'workspace-2', workflowId: 'workflow' }
    state.workflows = { workflow: { name: 'Old workspace title' } }
    state.placeholder = true
    act(() => root.render(<VscodeEditorTitle />))
    state.params = { workspaceId: 'workspace-2', chatId: 'chat' }
    state.chats = [{ id: 'chat', name: 'Old workspace chat' }]
    act(() => root.render(<VscodeEditorTitle />))
    state.placeholder = false
    state.chats = []
    act(() => root.render(<VscodeEditorTitle />))
    expect(setEditorTitle).not.toHaveBeenCalled()
  })

  it('waits for a late bridge, deduplicates context updates and reports to a replacement bridge', () => {
    state.params = { workspaceId: 'workspace-1', dagId: 'plan' }
    state.dag = { name: 'Persisted plan' }
    window.vibeVscode = undefined
    act(() => root.render(<VscodeEditorTitle />))
    expect(setEditorTitle).not.toHaveBeenCalled()
    window.vibeVscode = createBridge()
    window.dispatchEvent(new Event('vibe-vscode-context'))
    window.dispatchEvent(new Event('vibe-vscode-context'))
    expect(setEditorTitle).toHaveBeenCalledTimes(1)
    window.vibeVscode = createBridge()
    window.dispatchEvent(new Event('vibe-vscode-context'))
    expect(setEditorTitle).toHaveBeenCalledTimes(2)
    act(() => root.render(null))
    window.vibeVscode = createBridge()
    window.dispatchEvent(new Event('vibe-vscode-context'))
    expect(setEditorTitle).toHaveBeenCalledTimes(2)
  })
})
