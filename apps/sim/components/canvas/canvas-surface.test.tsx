/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactFlowProps } from 'reactflow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_FIT_VIEW_OPTIONS } from '@/components/canvas/canvas-constants'
import { CANVAS_DOCUMENT_KINDS } from '@/lib/canvas/types'

const mocks = vi.hoisted(() => {
  const onError = vi.fn()
  return {
    renderFlow: vi.fn<(props: ReactFlowProps) => void>(),
    store: {
      getState: vi.fn(() => ({ onError })),
      setState: vi.fn(),
    },
  }
})

vi.mock('reactflow', () => ({
  default: (props: ReactFlowProps) => {
    mocks.renderFlow(props)
    return null
  },
  useStoreApi: () => mocks.store,
}))

import { CanvasSurface } from '@/components/canvas/canvas-surface'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe.each(CANVAS_DOCUMENT_KINDS)('CanvasSurface (%s) defaults', (documentKind) => {
  it('supplies the shared viewport and attribution defaults without an editor override', () => {
    act(() => root.render(<CanvasSurface documentKind={documentKind} />))

    const props = mocks.renderFlow.mock.calls.at(-1)?.[0]
    expect(props?.fitViewOptions).toBe(CANVAS_FIT_VIEW_OPTIONS)
    expect(props).toMatchObject({
      'data-canvas-document-kind': documentKind,
      proOptions: { hideAttribution: true },
    })
  })

  it('preserves adapter-specific framing without redefining the shared defaults', () => {
    const fitViewOptions = { ...CANVAS_FIT_VIEW_OPTIONS, padding: 0.18 }
    const proOptions = { hideAttribution: false }
    act(() =>
      root.render(
        <CanvasSurface
          documentKind={documentKind}
          fitViewOptions={fitViewOptions}
          proOptions={proOptions}
        />
      )
    )

    const props = mocks.renderFlow.mock.calls.at(-1)?.[0]
    expect(props?.fitViewOptions).toBe(fitViewOptions)
    expect(props?.proOptions).toBe(proOptions)
    expect(CANVAS_FIT_VIEW_OPTIONS.padding).toBe(0.6)
  })
})
