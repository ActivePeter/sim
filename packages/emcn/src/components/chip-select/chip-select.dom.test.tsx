/**
 * @vitest-environment jsdom
 */

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChipSelect } from './chip-select'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(props: Partial<ComponentProps<typeof ChipSelect>> = {}): HTMLButtonElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ChipSelect
        options={[{ value: 'workflow-1', label: 'Workflow 1' }]}
        value=''
        aria-label='Workflow'
        aria-required
        aria-invalid
        aria-describedby='workflow-error'
        {...props}
      />
    )
  )

  const trigger = container.querySelector<HTMLButtonElement>('button')
  if (!trigger) throw new Error('ChipSelect did not render a trigger')
  return trigger
}

function openMenu(trigger: HTMLButtonElement) {
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  act(() => vi.runOnlyPendingTimers())
}

function hover(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent('pointerover', { bubbles: true, clientX: 200, clientY: 200 })
    )
  })
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe('ChipSelect', () => {
  it('forwards field accessibility attributes to its trigger', () => {
    const trigger = mount()

    expect(trigger.getAttribute('aria-label')).toBe('Workflow')
    expect(trigger.getAttribute('aria-required')).toBe('true')
    expect(trigger.getAttribute('aria-invalid')).toBe('true')
    expect(trigger.getAttribute('aria-describedby')).toBe('workflow-error')
  })

  it.each([false, true])('shows option details on hover (multiSelect=%s)', (multiSelect) => {
    const onChange = vi.fn()
    const onMultiSelectChange = vi.fn()
    const trigger = mount({
      options: [
        { value: 'repo-a', label: 'repo', tooltip: 'file:///worktrees/repo-a' },
        { value: 'repo-b', label: 'repo' },
      ],
      multiSelect,
      onChange,
      onMultiSelectChange,
    })
    openMenu(trigger)
    const items = document.querySelectorAll<HTMLElement>(
      multiSelect ? '[role="menuitemcheckbox"]' : '[role="menuitem"]'
    )
    expect(items).toHaveLength(2)
    act(() => items[1].focus())
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    hover(items[0])
    const tooltip = document.querySelector('[role="tooltip"]')
    expect(tooltip?.textContent).toBe('file:///worktrees/repo-a')
    expect(items[0].getAttribute('aria-describedby')).toBe(tooltip?.id)

    act(() => items[0].click())
    if (multiSelect) expect(onMultiSelectChange).toHaveBeenCalledExactlyOnceWith(['repo-a'])
    else {
      expect(onChange).toHaveBeenCalledExactlyOnceWith('repo-a')
      expect(document.querySelector('[role="tooltip"]')).toBeNull()
    }
  })

  it('shows option details on keyboard focus and preserves Enter selection', () => {
    const onChange = vi.fn()
    const trigger = mount({
      options: [
        {
          value: 'repo-a',
          label: 'repo',
          tooltip: 'vscode-remote://ssh-remote+runner/worktrees/repo-a',
        },
      ],
      onChange,
    })
    openMenu(trigger)
    const item = document.querySelector<HTMLElement>('[role="menuitem"]')!
    act(() => item.focus())
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      'vscode-remote://ssh-remote+runner/worktrees/repo-a'
    )

    act(() => item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('repo-a')
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('does not add a supplemental tooltip for options without one', () => {
    openMenu(mount())
    hover(document.querySelector<HTMLElement>('[role="menuitem"]')!)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
})
