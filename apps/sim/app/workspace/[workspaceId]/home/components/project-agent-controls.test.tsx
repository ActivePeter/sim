/** @vitest-environment jsdom */
import { act, type ComponentProps, type PropsWithChildren, type ReactNode } from 'react'
import type { ChipConfirmModalProps } from '@sim/emcn'
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
    ChipConfirmModal: ({
      open,
      title,
      text,
      defaultAction,
      dismissLabel,
      onOpenChange,
      confirm,
    }: ChipConfirmModalProps) =>
      open ? (
        <div role='dialog' data-default-action={defaultAction}>
          {title}
          {typeof text === 'string' ? <p>{text}</p> : null}
          <button onClick={() => onOpenChange(false)} disabled={confirm.pending}>
            {dismissLabel}
          </button>
          <button onClick={confirm.onClick} disabled={confirm.disabled || confirm.pending}>
            {confirm.label}
          </button>
        </div>
      ) : null,
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
      permissions: {
        defaultMode: 'workspace-write',
        description: 'Test deployment allows project writes',
        modes: [
          { id: 'read-only', label: '只读', description: 'Read without writing' },
          { id: 'workspace-write', label: '项目内读写', description: 'Write inside the project' },
        ],
      },
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
      permissions: {
        defaultMode: 'read-only',
        description: 'Read tools only',
        modes: [{ id: 'read-only', label: '只读工具', description: 'Read / Grep / Glob only' }],
      },
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
const unrestrictedData: NonNullable<Props['data']> = {
  ...data,
  agents: data.agents.map((agent) => ({
    ...agent,
    permissions: {
      ...agent.permissions,
      modes: [
        ...agent.permissions.modes,
        { id: 'danger-full-access', label: '不限制', description: 'No execution sandbox' },
      ],
    },
  })),
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
      {
        agentId: 'local-claude',
        model: null,
        reasoningEffort: null,
        permissionMode: null,
        instructions: 'Use Chinese.',
      },
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
        permissionMode: null,
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
    expect(dropdown('切换执行权限').disabled).toBe(true)
    permissions.canEdit = false
    render({ saving: false })
    act(() => button('项目 Agent 配置').click())
    expect(dropdown('模型').disabled).toBe(true)
    expect(dropdown('切换执行权限').disabled).toBe(true)
    expect(dropdown('配置执行权限').disabled).toBe(true)
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
  it('switches permission directly beside an existing conversation without changing its Agent or model', async () => {
    render({ hasMessages: true })
    expect(dropdown('切换项目 Agent').disabled).toBe(true)
    expect(dropdown('切换执行权限').disabled).toBe(false)
    expect(optionValues('切换执行权限')).toEqual([
      '__deployment_default__',
      'read-only',
      'workspace-write',
    ])
    await act(async () => select('切换执行权限', 'read-only'))
    const { version: _version, revision, ...settings } = data.config
    expect(props.onSave).toHaveBeenCalledWith(
      { ...settings, permissionMode: 'read-only' },
      revision
    )
    render({
      data: { ...data, config: { ...data.config, permissionMode: 'read-only', revision: 1 } },
    })
    expect(dropdown('切换执行权限').value).toBe('read-only')
    await act(async () => select('切换执行权限', 'workspace-write'))
    expect(props.onSave).toHaveBeenLastCalledWith(
      { ...settings, permissionMode: 'workspace-write' },
      1
    )
  })
  it('keeps the saved permission visible and reports a failed inline change', async () => {
    render({ onSave: vi.fn().mockRejectedValue(new Error('Permission save failed')) })
    await act(async () => select('切换执行权限', 'read-only'))
    expect(dropdown('切换执行权限').value).toBe('__deployment_default__')
    expect(container.textContent).toContain('Permission save failed')
  })
  it('offers unrestricted only from the server catalog and keeps the saved permission when cancelled', async () => {
    render({ data: unrestrictedData, hasMessages: true })
    expect(optionValues('切换执行权限')).toEqual([
      '__deployment_default__',
      'read-only',
      'workspace-write',
      'danger-full-access',
    ])
    await act(async () => select('切换执行权限', 'danger-full-access'))
    expect(props.onSave).not.toHaveBeenCalled()
    expect(dropdown('切换执行权限').value).toBe('__deployment_default__')
    expect(container.textContent).toContain('启用“不限制”权限？')
    expect(container.textContent).toContain('项目外文件并执行命令')
    expect(container.textContent).toContain('不会修改其他会话或部署默认')
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-default-action')).toBe(
      'dismiss'
    )
    act(() => button('保持当前权限').click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(dropdown('切换执行权限').value).toBe('__deployment_default__')
    expect(props.onSave).not.toHaveBeenCalled()
  })
  it('saves an explicitly confirmed inline permission without changing the runtime or model', async () => {
    render({
      data: { ...unrestrictedData, config: { ...data.config, revision: 5 } },
      hasMessages: true,
    })
    await act(async () => select('切换执行权限', 'danger-full-access'))
    expect(props.onSave).not.toHaveBeenCalled()
    await act(async () => button('确认启用不限制').click())
    const { version: _version, revision: _revision, ...settings } = data.config
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(
      { ...settings, permissionMode: 'danger-full-access' },
      5
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    render({
      data: {
        ...unrestrictedData,
        config: { ...data.config, permissionMode: 'danger-full-access', revision: 6 },
      },
    })
    expect(dropdown('切换执行权限').value).toBe('danger-full-access')
  })
  it('preserves the configuration draft after dismissing confirmation and closes it only after a confirmed save', async () => {
    render({ data: unrestrictedData })
    act(() => button('项目 Agent 配置').click())
    select('配置执行权限', 'danger-full-access')
    type('会话指令', 'Keep my edited instructions')
    await act(async () => button('保存配置').click())
    expect(props.onSave).not.toHaveBeenCalled()
    act(() => button('保持当前权限').click())
    expect(dropdown('配置执行权限').value).toBe('danger-full-access')
    expect(input('会话指令').value).toBe('Keep my edited instructions')
    expect(dropdown('切换执行权限').value).toBe('__deployment_default__')
    await act(async () => button('保存配置').click())
    await act(async () => button('确认启用不限制').click())
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        permissionMode: 'danger-full-access',
        instructions: 'Keep my edited instructions',
      }),
      0
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
  it.each(['inline', 'configuration'])(
    'retains the initiating settings and revision across a background update while confirming: %s',
    async (source) => {
      render({ data: unrestrictedData })
      if (source === 'configuration') {
        act(() => button('项目 Agent 配置').click())
        select('配置执行权限', 'danger-full-access')
        await act(async () => button('保存配置').click())
      } else {
        await act(async () => select('切换执行权限', 'danger-full-access'))
      }
      render({
        data: {
          ...unrestrictedData,
          config: {
            ...data.config,
            revision: 3,
            model: 'different-model',
            reasoningEffort: 'ultra',
            permissionMode: 'read-only',
          },
        },
        onSave: vi.fn().mockRejectedValue(new Error('Configuration changed')),
      })
      await act(async () => button('确认启用不限制').click())
      const { version: _version, revision, ...settings } = data.config
      expect(props.onSave).toHaveBeenCalledExactlyOnceWith(
        { ...settings, permissionMode: 'danger-full-access' },
        revision
      )
      expect(dropdown('切换执行权限').value).toBe('read-only')
      expect(container.textContent).toContain('Configuration changed')
      if (source === 'configuration') {
        expect(dropdown('配置执行权限').value).toBe('danger-full-access')
        expect(dropdown('模型').value).toBe('codex-model')
      }
    }
  )
  it.each(['deployment', 'workspace', 'runtime', 'saving'])(
    'cannot confirm after the current permission or availability is withdrawn: %s',
    async (reason) => {
      render({ data: unrestrictedData })
      await act(async () => select('切换执行权限', 'danger-full-access'))
      if (reason === 'deployment') render({ data })
      if (reason === 'workspace') {
        permissions.canEdit = false
        render()
      }
      if (reason === 'runtime') {
        render({
          data: {
            ...unrestrictedData,
            agents: unrestrictedData.agents.map((agent) => ({ ...agent, available: false })),
          },
        })
      }
      if (reason === 'saving') render({ saving: true })
      expect(button('确认启用不限制').disabled).toBe(true)
      await act(async () => button('确认启用不限制').click())
      expect(props.onSave).not.toHaveBeenCalled()
    }
  )
  it('does not reconfirm an unrestricted session when only its model changes', async () => {
    render({
      data: {
        ...unrestrictedData,
        config: { ...data.config, permissionMode: 'danger-full-access' },
      },
      hasMessages: true,
    })
    act(() => button('项目 Agent 配置').click())
    select('模型', 'different-model')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ model: 'different-model', permissionMode: 'danger-full-access' }),
      0
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
  it.each(['inline', 'configuration'])(
    'requires a new confirmation before moving unrestricted execution to another runtime: %s',
    async (source) => {
      render({
        data: {
          ...unrestrictedData,
          config: { ...data.config, permissionMode: 'danger-full-access' },
        },
      })
      if (source === 'configuration') {
        act(() => button('项目 Agent 配置').click())
        select('配置 Agent', 'local-claude')
        await act(async () => button('保存配置').click())
      } else {
        await act(async () => select('切换项目 Agent', 'local-claude'))
      }
      expect(props.onSave).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Configured Claude 将不使用执行沙箱')
      await act(async () => button('确认启用不限制').click())
      expect(props.onSave).toHaveBeenCalledExactlyOnceWith(
        {
          agentId: 'local-claude',
          model: null,
          reasoningEffort: null,
          permissionMode: 'danger-full-access',
          instructions: 'Use Chinese.',
        },
        0
      )
    }
  )
  it.each([null, 'read-only', 'workspace-write'] as const)(
    'does not require confirmation to narrow an unrestricted session: %s',
    async (permissionMode) => {
      render({
        data: {
          ...unrestrictedData,
          config: { ...data.config, permissionMode: 'danger-full-access' },
        },
      })
      await act(async () => select('切换执行权限', permissionMode ?? '__deployment_default__'))
      expect(props.onSave).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ permissionMode }),
        0
      )
      expect(container.querySelector('[role="dialog"]')).toBeNull()
    }
  )
  it('keeps an explicit read-only choice when changing models or inheriting the runner model', async () => {
    render({ data: { ...data, config: { ...data.config, permissionMode: 'read-only' } } })
    act(() => button('项目 Agent 配置').click())
    select('模型', 'different-model')
    expect(dropdown('配置执行权限').value).toBe('read-only')
    select('模型', '__runtime_default__')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ model: null, reasoningEffort: null, permissionMode: 'read-only' }),
      0
    )
  })
  it('preserves a permission draft through a newer server revision and failed stale save', async () => {
    render()
    act(() => button('项目 Agent 配置').click())
    select('配置执行权限', 'read-only')
    render({
      data: { ...data, config: { ...data.config, permissionMode: 'workspace-write', revision: 3 } },
      onSave: vi.fn().mockRejectedValue(new Error('Configuration changed')),
    })
    expect(dropdown('切换执行权限').value).toBe('workspace-write')
    expect(dropdown('配置执行权限').value).toBe('read-only')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: 'read-only' }),
      0
    )
    expect(dropdown('配置执行权限').value).toBe('read-only')
    act(() => button('载入当前配置').click())
    expect(dropdown('配置执行权限').value).toBe('workspace-write')
  })
  it('takes permissions from the selected Agent and retains compatible restrictions on Agent changes', async () => {
    render({ data: { ...data, config: { ...data.config, permissionMode: 'read-only' } } })
    act(() => button('项目 Agent 配置').click())
    select('配置 Agent', 'local-claude')
    expect(optionValues('配置执行权限')).toEqual(['__deployment_default__', 'read-only'])
    expect(dropdown('配置执行权限').value).toBe('read-only')
    select('配置 Agent', 'local-codex')
    expect(dropdown('配置执行权限').value).toBe('read-only')
    await act(async () => button('保存配置').click())
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: 'read-only' }),
      0
    )
  })
  it.each(['workspace-write', 'danger-full-access'] as const)(
    'requires explicit repair of a previously saved permission removed by the deployment: %s',
    async (permissionMode) => {
      render({
        data: {
          ...data,
          config: { ...data.config, permissionMode },
          agents: data.agents.map((agent) => ({
            ...agent,
            permissions: data.agents[1].permissions,
          })),
        },
      })
      expect(dropdown('切换执行权限').value).toBe(permissionMode)
      expect(container.textContent).toContain('已保存的执行权限不被当前部署允许')
      expect(props.onSave).not.toHaveBeenCalled()
      act(() => button('项目 Agent 配置').click())
      expect(button('保存配置').disabled).toBe(true)
      expect(
        dropdown('配置执行权限').querySelector<HTMLOptionElement>(
          `option[value="${permissionMode}"]`
        )!.disabled
      ).toBe(true)
      select('配置执行权限', 'read-only')
      await act(async () => button('保存配置').click())
      expect(props.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ permissionMode: 'read-only' }),
        0
      )
    }
  )
})
