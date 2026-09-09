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
      searchable,
      'aria-label': label,
    }: {
      options: { value: string; label: string; disabled?: boolean }[]
      value?: string
      onChange(value: string): void
      disabled?: boolean
      searchable?: boolean
      'aria-label': string
    }) => (
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        data-searchable={searchable}
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
      error,
      disabled,
    }: {
      type: string
      title: string
      value?: string
      onChange?(value: string): void
      children?: ReactNode
      hint?: string
      error?: string
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
        {error && <span role='alert'>{error}</span>}
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
      modelCatalog: {
        status: 'ready',
        models: [
          {
            id: 'codex-model',
            label: 'Codex Model',
            description: 'Balanced model',
            reasoningEfforts: ['low', 'high'],
            defaultReasoningEffort: 'high',
          },
          {
            id: 'different-model',
            label: 'Reasoning Model',
            description: 'Extended reasoning',
            reasoningEfforts: ['low', 'xhigh', 'max', 'ultra'],
            defaultReasoningEffort: 'low',
          },
          {
            id: 'no-reasoning',
            label: 'No reasoning',
            description: '',
            reasoningEfforts: [],
            defaultReasoningEffort: null,
          },
        ],
      },
    },
    {
      id: 'local-claude',
      label: 'Configured Claude',
      available: true,
      permissionLabel: 'Read tools only',
      modelCatalog: {
        status: 'ready',
        models: [
          {
            id: 'claude-model',
            aliases: ['claude-full-id'],
            label: 'Claude Model',
            description: '',
            reasoningEfforts: ['medium', 'max'],
            defaultReasoningEffort: null,
          },
          {
            id: 'default',
            label: 'Claude default alias',
            description: '',
            reasoningEfforts: ['medium'],
            defaultReasoningEffort: null,
          },
        ],
      },
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
  const target = dropdown(label)
  act(() => {
    target.value = value
    target.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
function dropdown(label: string) {
  const target = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)
  if (!target) throw new Error(`Missing select ${label}`)
  return target
}
function optionValues(label: string) {
  return Array.from(dropdown(label).options).map((option) => option.value)
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
    select('模型', 'different-model')
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
    select('模型', 'different-model')
    render({
      data: { ...data, config: { ...data.config, revision: 2, model: 'other-tab' } },
      onSave: vi.fn().mockRejectedValue(new Error('Configuration changed')),
    })
    expect(dropdown('模型').value).toBe('different-model')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'different-model' }),
      0
    )
    expect(container.textContent).toContain('Configuration changed')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => button('载入当前配置').click())
    expect(dropdown('模型').value).toBe('other-tab')
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
      '__runtime_default__',
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
    expect(dropdown('模型').disabled).toBe(true)
    expect(button('保存配置').disabled).toBe(true)
  })
  it('offers a searchable server model list, with levels belonging to the selected model only', () => {
    render()
    act(() => button('项目 Agent 配置').click())
    expect(dropdown('模型').dataset.searchable).toBe('true')
    expect(optionValues('模型')).toEqual([
      '__runtime_default__',
      'codex-model',
      'different-model',
      'no-reasoning',
    ])
    expect(container.querySelector('input[aria-label="模型"]')).toBeNull()
    select('模型', 'different-model')
    expect({ options: optionValues('推理强度'), value: dropdown('推理强度').value }).toEqual({
      options: ['__runtime_default__', 'low', 'xhigh', 'max', 'ultra'],
      value: '__runtime_default__',
    })
    select('推理强度', 'low')
    select('模型', 'codex-model')
    expect(dropdown('推理强度').value).toBe('low')
  })
  it('resets incompatible levels, including for a model with no reasoning controls', async () => {
    render()
    act(() => button('项目 Agent 配置').click())
    select('模型', 'different-model')
    select('推理强度', 'ultra')
    select('模型', 'no-reasoning')
    expect({ value: dropdown('推理强度').value, disabled: dropdown('推理强度').disabled }).toEqual({
      value: '__runtime_default__',
      disabled: true,
    })
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'no-reasoning', reasoningEffort: null }),
      0
    )
  })
  it('distinguishes the runtime default from a provider model actually named default', async () => {
    render()
    act(() => button('项目 Agent 配置').click())
    select('配置 Agent', 'local-claude')
    expect(optionValues('模型')).toEqual(['__runtime_default__', 'claude-model', 'default'])
    select('模型', 'default')
    select('推理强度', 'medium')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'local-claude',
        model: 'default',
        reasoningEffort: 'medium',
      }),
      0
    )
  })
  it('leaves unknown saved models visible and unchanged until the user chooses a replacement', () => {
    render({ data: { ...data, config: { ...data.config, model: 'retired-model' } } })
    act(() => button('项目 Agent 配置').click())
    expect(dropdown('模型').value).toBe('retired-model')
    expect(container.textContent).toContain('已保存的模型不在当前目录')
    expect(button('保存配置').disabled).toBe(true)
    expect(props.onSave).not.toHaveBeenCalled()
    select('模型', 'codex-model')
    expect(button('保存配置').disabled).toBe(false)
    expect(dropdown('推理强度').value).toBe('high')
  })
  it('recognizes a saved resolved model ID reported by the runtime as an alias', () => {
    render({
      data: {
        ...data,
        config: {
          ...data.config,
          agentId: 'local-claude',
          model: 'claude-full-id',
          reasoningEffort: 'max',
        },
      },
    })
    act(() => button('项目 Agent 配置').click())
    expect({
      model: dropdown('模型').value,
      level: dropdown('推理强度').value,
      canSave: !button('保存配置').disabled,
    }).toEqual({ model: 'claude-full-id', level: 'max', canSave: true })
  })
  it('preserves the draft across failed and delayed catalog refreshes without rebinding it to another runtime', () => {
    render()
    act(() => button('项目 Agent 配置').click())
    select('模型', 'different-model')
    type('会话指令', 'Keep my unsaved instructions')
    select('推理强度', 'ultra')
    render({
      data: {
        ...data,
        agents: data.agents.map((agent) =>
          agent.id === 'local-codex'
            ? { ...agent, modelCatalog: { status: 'error', message: 'Catalog offline' } }
            : agent
        ),
      },
    })
    expect(dropdown('模型').value).toBe('different-model')
    expect(container.textContent).toContain('Catalog offline')
    expect(container.textContent).not.toContain('已保存的模型不在当前目录')
    expect(container.textContent).not.toContain('当前模型不支持已保存的 level')
    expect(dropdown('推理强度').value).toBe('ultra')
    act(() => button('重试模型目录').click())
    expect(props.onRefresh).toHaveBeenCalledOnce()
    select('配置 Agent', 'local-claude')
    select('模型', 'claude-model')
    render({ data })
    expect({
      agent: dropdown('配置 Agent').value,
      model: dropdown('模型').value,
      instructions: input('会话指令').value,
      levels: optionValues('推理强度'),
    }).toEqual({
      agent: 'local-claude',
      model: 'claude-model',
      instructions: 'Keep my unsaved instructions',
      levels: ['__runtime_default__', 'medium', 'max'],
    })
  })
  it('keeps invalid legacy levels visible and requires explicit repair, never silently saves them', async () => {
    render({ data: { ...data, config: { ...data.config, reasoningEffort: 'ultra' } } })
    act(() => button('项目 Agent 配置').click())
    expect(dropdown('推理强度').value).toBe('ultra')
    expect(button('保存配置').disabled).toBe(true)
    select('推理强度', '__runtime_default__')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'codex-model', reasoningEffort: null }),
      0
    )
  })
  it('uses the runtime default as a paired model/effort choice even if discovery is unavailable', async () => {
    render({
      data: {
        ...data,
        agents: data.agents.map((agent) => ({
          ...agent,
          modelCatalog: { status: 'error', message: 'Catalog offline' },
        })),
      },
    })
    act(() => button('项目 Agent 配置').click())
    select('模型', '__runtime_default__')
    expect(dropdown('推理强度').disabled).toBe(true)
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ model: null, reasoningEffort: null }),
      0
    )
  })
})
