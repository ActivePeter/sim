/** @vitest-environment jsdom */
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VibeVscodeHostContext, VscodeHost } from '@/lib/api/contracts/vscode-agents'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  push: vi.fn(),
  refetch: vi.fn(),
  context: undefined as VibeVscodeHostContext | undefined,
  host: undefined as VscodeHost | undefined,
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams('_vscodeSurface=sidebar'),
}))
vi.mock('nuqs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuqs')>()),
  useQueryState: () => [null, vi.fn()],
}))
vi.mock('@/hooks/queries/vscode-agents', () => ({
  useVscodeHosts: () => ({
    data: { hosts: [mocks.host] },
    isPending: false,
    refetch: mocks.refetch,
  }),
  useCreateProjectSession: () => ({ mutateAsync: mocks.create, isPending: false }),
}))
vi.mock('@/hooks/use-vscode-host-context', () => ({ useVscodeHostContext: () => mocks.context }))
vi.mock('@/hooks/use-vscode-catalog-projection', () => ({
  useVscodeCatalogProjection: () => ({ host: mocks.host, isSyncing: false, retry: vi.fn() }),
}))
vi.mock('@sim/emcn', () => ({
  Chip: ({ children, onClick, disabled }: ComponentProps<'button'>) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ChipSelect: ({
    value,
    options,
    onChange,
  }: {
    value: string
    options: { value: string; label: string }[]
    onChange(value: string): void
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
  OverflowText: ({ label }: { label: string }) => <span>{label}</span>,
}))

import { ProjectLauncher } from '@/app/workspace/[workspaceId]/agents/components/project-launcher'

let root: Root
let container: HTMLDivElement
function createButton() {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('新建项目')
  )!
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.host = {
    id: 'host-1',
    revision: 1,
    updatedAt: '',
    catalog: {
      physicalWorkspace: {
        id: 'physical-1',
        name: 'Workspace',
        remoteAuthority: '',
        folders: [
          { name: 'A', uri: 'file:///project-a', index: 0 },
          { name: 'B', uri: 'file:///project-b', index: 1 },
        ],
      },
      logicalWorkspaces: [{ id: 'logical-1', name: 'Logical' }],
    },
  }
  mocks.context = {
    language: 'zh-cn',
    ...mocks.host.catalog,
    logicalWorkspace: mocks.host.catalog.logicalWorkspaces[0],
    project: mocks.host.catalog.physicalWorkspace.folders[0],
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<ProjectLauncher compact />))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('project Agent launch intent', () => {
  it('guards same-tick duplicate clicks and opens the native chat ID', async () => {
    const pending = deferred<{ id: string; workspaceId: string }>()
    mocks.create.mockReturnValueOnce(pending.promise)
    act(() => {
      createButton().click()
      createButton().click()
    })
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      hostId: 'host-1',
      projectUri: 'file:///project-a',
      logicalWorkspaceId: 'logical-1',
    })
    await act(async () => pending.resolve({ id: 'native-chat', workspaceId: 'workspace-1' }))
    expect(mocks.push).toHaveBeenCalledWith(
      '/workspace/workspace-1/chat/native-chat?_vscodeSurface=sidebar'
    )
  })

  it('does not navigate back to a stale project after selection changes while creating', async () => {
    const pending = deferred<{ id: string; workspaceId: string }>()
    mocks.create.mockReturnValueOnce(pending.promise)
    act(() => createButton().click())
    mocks.context = { ...mocks.context!, project: mocks.host!.catalog.physicalWorkspace.folders[1] }
    act(() => root.render(<ProjectLauncher compact />))
    await act(async () => pending.resolve({ id: 'agent-for-a', workspaceId: 'workspace-1' }))
    expect(mocks.create.mock.calls[0][0].projectUri).toBe('file:///project-a')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('reuses the creation key after an unknown network outcome', async () => {
    mocks.create
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ id: 'same-chat', workspaceId: 'workspace-1' })
    await act(async () => createButton().click())
    await act(async () => createButton().click())
    expect(mocks.create.mock.calls[0][0].requestId).toBe(mocks.create.mock.calls[1][0].requestId)
    expect(mocks.push).toHaveBeenCalledWith(
      '/workspace/workspace-1/chat/same-chat?_vscodeSurface=sidebar'
    )
  })

  it('waits for authoritative host context instead of launching the first cached project', () => {
    mocks.context = undefined
    act(() => root.render(<ProjectLauncher compact />))
    expect(createButton().disabled).toBe(true)
    expect(container.textContent).toContain('读取 VS Code 项目')
  })
})
