/** @vitest-environment jsdom */
import { act, type ComponentProps, type PropsWithChildren, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const permissions = vi.hoisted(() => ({ canEdit: true }))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => permissions,
}))
vi.mock('@sim/emcn', () => {
  const Wrap = ({ children }: PropsWithChildren) => <>{children}</>
  return {
    Chip: ({ children, ...props }: ComponentProps<'button'>) => (
      <button {...props}>{children}</button>
    ),
    ChipSelect: ({
      options,
      value,
      onChange,
      disabled,
      'aria-label': label,
    }: {
      options: { value: string; label: string; disabled?: boolean }[]
      value?: string
      onChange(value: string): void
      disabled?: boolean
      'aria-label': string
    }) => (
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    ),
    ChipModal: ({ open, children }: PropsWithChildren<{ open: boolean }>) =>
      open ? <div role='dialog'>{children}</div> : null,
    ChipModalHeader: Wrap,
    ChipModalBody: Wrap,
    ChipModalError: Wrap,
    ChipModalField: ({
      type,
      title,
      value,
      onChange,
      children,
      hint,
      disabled,
    }: {
      type: string
      title: string
      value?: string
      onChange?(value: string): void
      children?: ReactNode
      hint?: string
      disabled?: boolean
    }) => (
      <div>
        {title}
        {type === 'custom' ? (
          children
        ) : (
          <input
            aria-label={title}
            value={value ?? ''}
            onChange={(event) => onChange?.(event.target.value)}
            disabled={disabled}
          />
        )}
        {hint}
      </div>
    ),
    ChipModalFooter: ({
      primaryAction,
      onCancel,
      cancelDisabled,
    }: {
      primaryAction: { label: string; onClick(): void; disabled?: boolean }
      onCancel(): void
      cancelDisabled?: boolean
    }) => (
      <>
        <button onClick={onCancel} disabled={cancelDisabled}>
          取消
        </button>
        <button onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
          {primaryAction.label}
        </button>
      </>
    ),
    Tooltip: { Root: Wrap, Trigger: Wrap, Content: () => null },
    OverflowText: ({ label }: { label: string }) => <span>{label}</span>,
  }
})

import { DEFAULT_PROJECT_AGENT_CONFIG } from '@/lib/vibe-vscode/agent-config'
import { ProjectAgentControls } from '@/app/workspace/[workspaceId]/home/components/project-agent-controls'

type Props = ComponentProps<typeof ProjectAgentControls>
const data: NonNullable<Props['data']> = {
  config: {
    ...DEFAULT_PROJECT_AGENT_CONFIG,
    model: 'codex-model',
    reasoningEffort: 'high',
    instructions: 'Use Chinese.',
  },
  agentLocked: false,
  agents: [
    {
      id: 'local-codex',
      label: 'Configured Codex',
      available: true,
      permissionLabel: 'Deployment read only',
      reasoningEfforts: ['low', 'high'],
    },
    {
      id: 'local-claude',
      label: 'Configured Claude',
      available: true,
      permissionLabel: 'Read tools only',
      reasoningEfforts: ['medium', 'max'],
    },
  ],
}
let root: Root
let container: HTMLDivElement
let props: Props
function render(overrides: Partial<Props> = {}) {
  props = { ...props, ...overrides }
  act(() => root.render(<ProjectAgentControls {...props} />))
}
function button(label: string) {
  const target = Array.from(container.querySelectorAll('button')).find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label
  )
  if (!target) throw new Error(`Missing button ${label}`)
  return target
}
function input(label: string) {
  const target = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!target) throw new Error(`Missing input ${label}`)
  return target
}
function type(label: string, value: string) {
  const target = input(label)
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(target, value)
    target.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function select(label: string, value: string) {
  const target = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
  act(() => {
    target.value = value
    target.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  permissions.canEdit = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  props = {
    data,
    loadError: null,
    saving: false,
    hasMessages: false,
    onRefresh: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
  }
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('native composer Agent controls', () => {
  it('renders the server catalog and clears incompatible model options when switching runtime', async () => {
    render()
    expect(container.textContent).toContain('Configured Claude')
    await act(async () => select('切换项目 Agent', 'local-claude'))
    expect(props.onSave).toHaveBeenCalledWith(
      { agentId: 'local-claude', model: null, reasoningEffort: null, instructions: 'Use Chinese.' },
      0
    )
  })
  it('locks only runtime identity after the first message, leaving next-turn configuration editable', async () => {
    render({ hasMessages: true })
    expect(
      container.querySelector<HTMLSelectElement>('select[aria-label="切换项目 Agent"]')!.disabled
    ).toBe(true)
    act(() => button('项目 Agent 配置').click())
    type('模型', ' different-model ')
    select('推理强度', 'low')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      {
        agentId: 'local-codex',
        model: 'different-model',
        reasoningEffort: 'low',
        instructions: 'Use Chinese.',
      },
      0
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
  it('does not clobber an unsaved draft with a background refetch or overwrite its revision', async () => {
    render()
    act(() => button('项目 Agent 配置').click())
    type('模型', 'my-draft')
    render({
      data: { ...data, config: { ...data.config, revision: 2, model: 'other-tab' } },
      onSave: vi.fn().mockRejectedValue(new Error('Configuration changed')),
    })
    expect(input('模型').value).toBe('my-draft')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ model: 'my-draft' }), 0)
    expect(container.textContent).toContain('Configuration changed')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => button('载入当前配置').click())
    expect(input('模型').value).toBe('other-tab')
  })
  it('uses only the selected runtime effort capabilities and keeps unavailable Agents disabled', () => {
    render({
      data: {
        ...data,
        agents: data.agents.map((agent) => ({ ...agent, available: agent.id === 'local-codex' })),
      },
    })
    expect(
      container.querySelector<HTMLOptionElement>('option[value="local-claude"]')!.disabled
    ).toBe(true)
    act(() => button('项目 Agent 配置').click())
    const efforts = container.querySelector<HTMLSelectElement>('select[aria-label="推理强度"]')!
    expect(Array.from(efforts.options).map((option) => option.value)).toEqual([
      'default',
      'low',
      'high',
    ])
  })
  it('shows a retryable load failure without inventing a default Agent', () => {
    render({ data: undefined, loadError: new Error('Network failed') })
    expect(container.textContent).toContain('Network failed')
    expect(container.querySelector('select')).toBeNull()
    act(() => button('重试').click())
    expect(props.onRefresh).toHaveBeenCalledOnce()
  })
  it('disables changes while saving or without workspace write permission', () => {
    render({ saving: true })
    expect(button('项目 Agent 配置').disabled).toBe(true)
    permissions.canEdit = false
    render({ saving: false })
    act(() => button('项目 Agent 配置').click())
    expect(input('模型').disabled).toBe(true)
    expect(button('保存配置').disabled).toBe(true)
  })
})
