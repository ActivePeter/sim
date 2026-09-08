/**
 * @vitest-environment jsdom
 */
import { act, type MouseEventHandler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReactFlowProvider } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_DOCUMENT_KINDS } from '@/lib/canvas/types'

const canvasSurfaceMock = vi.hoisted(() => vi.fn())
const reactFlowViewportMock = vi.hoisted(() => ({
  getViewport: vi.fn(() => ({ x: 10, y: 20, zoom: 1 })),
  setViewport: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('reactflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('reactflow')>()
  return { ...actual, useReactFlow: () => reactFlowViewportMock }
})

vi.mock('@/components/canvas/canvas-surface', () => ({
  CanvasSurface: (props: Record<string, unknown>) => {
    canvasSurfaceMock(props)
    const onMouseDownCapture = props.onMouseDownCapture as
      | MouseEventHandler<HTMLDivElement>
      | undefined
    return (
      <div data-testid='canvas-surface' onMouseDownCapture={onMouseDownCapture}>
        <div className='react-flow__pane' data-testid='canvas-pane' />
      </div>
    )
  },
}))

import { WorkflowCanvas } from '@/components/canvas/workflow-canvas'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  canvasSurfaceMock.mockClear()
  reactFlowViewportMock.getViewport.mockClear()
  reactFlowViewportMock.setViewport.mockClear()
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

describe.each(CANVAS_DOCUMENT_KINDS)('WorkflowCanvas (%s) interaction modes', (documentKind) => {
  it('draws a selection by default and pans while Control or Command is held', () => {
    act(() => {
      root.render(
        <ReactFlowProvider>
          <WorkflowCanvas documentKind={documentKind} interactionMode='cursor' />
        </ReactFlowProvider>
      )
    })

    expect(renderedSurfaceProps()).toMatchObject({
      documentKind,
      panActivationKeyCode: ['Control', 'Meta'],
      panOnDrag: [1],
      selectionKeyCode: 'Shift',
      selectionOnDrag: true,
    })
  })

  it('keeps direct left-button panning in the explicit hand mode', () => {
    act(() => {
      root.render(
        <ReactFlowProvider>
          <WorkflowCanvas documentKind={documentKind} interactionMode='hand' />
        </ReactFlowProvider>
      )
    })

    expect(renderedSurfaceProps()).toMatchObject({
      panActivationKeyCode: ['Control', 'Meta'],
      panOnDrag: [0, 1],
      selectionKeyCode: 'Shift',
      selectionOnDrag: false,
    })
  })

  it('manually pans Ctrl-modified mouse drags rejected by d3-zoom', () => {
    act(() => {
      root.render(
        <ReactFlowProvider>
          <WorkflowCanvas documentKind={documentKind} interactionMode='cursor' />
        </ReactFlowProvider>
      )
    })
    const pane = container.querySelector<HTMLElement>('[data-testid="canvas-pane"]')
    if (!pane) throw new Error('Canvas pane did not render')

    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      ctrlKey: true,
    })
    act(() => pane.dispatchEvent(mouseDown))
    act(() =>
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 130, clientY: 120 })
      )
    )

    expect(mouseDown.defaultPrevented).toBe(true)
    expect(reactFlowViewportMock.setViewport).toHaveBeenLastCalledWith({
      x: 40,
      y: 40,
      zoom: 1,
    })

    act(() => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  })

  it('preserves inspection but disables graph editing for read-only documents', () => {
    act(() => {
      root.render(
        <ReactFlowProvider>
          <WorkflowCanvas documentKind={documentKind} interactionMode='cursor' editable={false} />
        </ReactFlowProvider>
      )
    })

    expect(renderedSurfaceProps()).toMatchObject({
      elementsSelectable: true,
      nodesConnectable: false,
      nodesDraggable: false,
      edgesUpdatable: false,
      autoPanOnConnect: false,
      autoPanOnNodeDrag: false,
      deleteKeyCode: null,
    })
  })

  it('uses the same non-editable panning contract for embedded documents', () => {
    act(() => {
      root.render(
        <ReactFlowProvider>
          <WorkflowCanvas documentKind={documentKind} interactionMode='cursor' embedded />
        </ReactFlowProvider>
      )
    })

    expect(renderedSurfaceProps()).toMatchObject({
      elementsSelectable: false,
      selectionOnDrag: false,
      selectionKeyCode: null,
      multiSelectionKeyCode: null,
      nodesConnectable: false,
      nodesDraggable: false,
      edgesUpdatable: false,
      panOnDrag: true,
    })
  })
})
