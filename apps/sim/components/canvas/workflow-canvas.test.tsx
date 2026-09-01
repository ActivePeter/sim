/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const canvasSurfaceMock = vi.hoisted(() => vi.fn())

vi.mock('@/components/canvas/canvas-surface', () => ({
  CanvasSurface: (props: Record<string, unknown>) => {
    canvasSurfaceMock(props)
    return <div data-testid='canvas-surface' />
  },
}))

import { WorkflowCanvas } from '@/components/canvas/workflow-canvas'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  canvasSurfaceMock.mockClear()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderedSurfaceProps(): Record<string, unknown> {
  const call = canvasSurfaceMock.mock.calls.at(-1)
  if (!call) throw new Error('CanvasSurface did not render')
  return call[0]
}

describe('WorkflowCanvas interaction modes', () => {
  it('draws a selection by default and pans while Control or Command is held', () => {
    act(() => {
      root.render(<WorkflowCanvas documentKind='dag' interactionMode='cursor' />)
    })

    expect(renderedSurfaceProps()).toMatchObject({
      panActivationKeyCode: ['Control', 'Meta'],
      panOnDrag: [1],
      selectionKeyCode: 'Shift',
      selectionOnDrag: true,
    })
  })

  it('keeps direct left-button panning in the explicit hand mode', () => {
    act(() => {
      root.render(<WorkflowCanvas documentKind='dag' interactionMode='hand' />)
    })

    expect(renderedSurfaceProps()).toMatchObject({
      panActivationKeyCode: ['Control', 'Meta'],
      panOnDrag: [0, 1],
      selectionKeyCode: 'Shift',
      selectionOnDrag: false,
    })
  })
})
