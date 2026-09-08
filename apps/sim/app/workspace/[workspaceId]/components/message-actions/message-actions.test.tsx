/** @vitest-environment jsdom */
import { act, type PropsWithChildren } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  feedback: vi.fn(),
  fork: vi.fn(),
  push: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: 'workspace-1' }),
  useRouter: () => ({ push: mocks.push }),
}))
vi.mock('@/hooks/queries/copilot-feedback', () => ({
  useSubmitCopilotFeedback: () => ({ mutate: mocks.feedback }),
}))
vi.mock('@/hooks/queries/mothership-chats', () => ({
  useForkMothershipChat: () => ({ mutateAsync: mocks.fork, isPending: false }),
}))
vi.mock('@/stores/folders/store', () => ({
  useFolderStore: { getState: () => ({ clearChatSelection: vi.fn() }) },
}))
vi.mock('@sim/emcn', () => ({
  Check: () => null,
  Duplicate: () => null,
  Split: () => null,
  ThumbsDown: () => null,
  ThumbsUp: () => null,
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
  useCopyToClipboard: () => ({ copied: false, copy: mocks.copy }),
  toast: { warning: vi.fn(), error: vi.fn() },
  Tooltip: {
    Root: ({ children }: PropsWithChildren) => children,
    Trigger: ({ children }: PropsWithChildren) => children,
    Content: () => null,
  },
  ChipModal: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? children : null),
  ChipModalBody: ({ children }: PropsWithChildren) => children,
  ChipModalField: () => null,
  ChipModalFooter: () => null,
  ChipModalHeader: ({ children }: PropsWithChildren) => children,
}))

import { MessageActions } from '@/app/workspace/[workspaceId]/components/message-actions/message-actions'
import { ChatSurfaceProvider } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'

let root: Root
let container: HTMLDivElement
function renderActions(serviceActionsEnabled?: boolean) {
  act(() => {
    root.render(
      <ChatSurfaceProvider chatId='native-chat' serviceActionsEnabled={serviceActionsEnabled}>
        <MessageActions content='Agent answer' userQuery='User prompt' messageId='message-1' />
      </ChatSurfaceProvider>
    )
  })
}
function actionLabels() {
  return Array.from(container.querySelectorAll('button'), (button) =>
    button.getAttribute('aria-label')
  )
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('native message runtime capabilities', () => {
  it('keeps all existing service actions enabled by default', () => {
    renderActions()
    expect(actionLabels()).toEqual(['Copy message', 'Like', 'Dislike', 'Fork in new chat'])
  })

  it('allows local agents to copy without offering unsupported fork or feedback', () => {
    renderActions(false)
    expect(actionLabels()).toEqual(['Copy message'])
    act(() => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(mocks.copy).toHaveBeenCalledWith('Agent answer')
    expect(mocks.feedback).not.toHaveBeenCalled()
    expect(mocks.fork).not.toHaveBeenCalled()
  })

  it('updates capabilities without changing native chat identity', () => {
    renderActions()
    renderActions(false)
    expect(actionLabels()).toEqual(['Copy message'])
    renderActions()
    expect(actionLabels()).toEqual(['Copy message', 'Like', 'Dislike', 'Fork in new chat'])
  })
})
