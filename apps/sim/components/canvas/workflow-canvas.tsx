'use client'

import { type MouseEventHandler, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { ConnectionLineType, type ReactFlowProps, SelectionMode, useReactFlow } from 'reactflow'
import type { CanvasInteractionMode } from '@/components/canvas/canvas-action-bar'
import { CanvasSurface, type CanvasSurfaceProps } from '@/components/canvas/canvas-surface'
import type { CanvasDocumentKind } from '@/lib/canvas/types'

const DEFAULT_CONNECTION_LINE_STYLE = {
  stroke: 'var(--connection-line-stroke, var(--text-secondary))',
  strokeWidth: 2,
} as const
const DEFAULT_PAN_ACTIVATION_KEY_CODE: NonNullable<ReactFlowProps['panActivationKeyCode']> = [
  'Control',
  'Meta',
]

interface CanvasSelectionProps {
  panOnDrag: number[]
  selectionKeyCode: string | null
  selectionOnDrag: boolean
}

interface UseCanvasSelectionResult {
  handleMouseDown: NonNullable<ReactFlowProps['onMouseDown']>
  selectionProps: CanvasSelectionProps
}

function supportsControlPan(keyCode: ReactFlowProps['panActivationKeyCode']): boolean {
  return Array.isArray(keyCode) ? keyCode.includes('Control') : keyCode === 'Control'
}

/** Adds Ctrl-drag panning because d3-zoom intentionally rejects Ctrl-modified mouse drags. */
function useControlDragPan(enabled: boolean): NonNullable<ReactFlowProps['onMouseDownCapture']> {
  const reactFlow = useReactFlow()
  const cleanupRef = useRef<() => void>(() => {})

  useEffect(() => () => cleanupRef.current(), [])

  return useCallback<NonNullable<ReactFlowProps['onMouseDownCapture']>>(
    (event) => {
      if (!enabled || event.button !== 0 || !event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement | null
      if (
        !target?.closest('.react-flow__pane, .react-flow__selectionpane') ||
        target.closest('.react-flow__node, .react-flow__edge, .nopan')
      ) {
        return
      }

      cleanupRef.current()
      const initialViewport = reactFlow.getViewport()
      const initialPointer = { x: event.clientX, y: event.clientY }
      const handleMouseMove = (moveEvent: MouseEvent) => {
        moveEvent.preventDefault()
        void reactFlow.setViewport({
          x: initialViewport.x + moveEvent.clientX - initialPointer.x,
          y: initialViewport.y + moveEvent.clientY - initialPointer.y,
          zoom: initialViewport.zoom,
        })
      }
      const cleanup = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', cleanup)
        cleanupRef.current = () => {}
      }
      cleanupRef.current = cleanup
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', cleanup)
      event.preventDefault()
      event.stopPropagation()
      window.getSelection()?.removeAllRanges()
    },
    [enabled, reactFlow]
  )
}

/** Preserves Workflow's Shift-selection gesture while sharing it with other graph documents. */
function useCanvasSelection(isHandMode: boolean): UseCanvasSelectionResult {
  const [isShiftSelecting, setIsShiftSelecting] = useState(false)

  const handleMouseDown = useCallback<NonNullable<ReactFlowProps['onMouseDown']>>(
    (event) => {
      if (!event.shiftKey) return

      const target = event.target as HTMLElement | null
      const isPaneTarget = Boolean(target?.closest('.react-flow__pane, .react-flow__selectionpane'))

      if (isPaneTarget && isHandMode) {
        setIsShiftSelecting(true)
      }

      if (isPaneTarget) {
        event.preventDefault()
        window.getSelection()?.removeAllRanges()
      }
    },
    [isHandMode]
  )

  useEffect(() => {
    if (!isShiftSelecting) return

    const handleMouseUp = () => setIsShiftSelecting(false)
    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [isShiftSelecting])

  return {
    handleMouseDown,
    selectionProps: {
      selectionOnDrag: !isHandMode || isShiftSelecting,
      panOnDrag: isHandMode && !isShiftSelecting ? [0, 1] : [1],
      selectionKeyCode: isShiftSelecting ? null : 'Shift',
    },
  }
}

export interface WorkflowCanvasProps extends Omit<CanvasSurfaceProps, 'documentKind'> {
  documentKind: CanvasDocumentKind
  editable?: boolean
  embedded?: boolean
  interactionMode: CanvasInteractionMode
}

/**
 * The shared Sim Workflow canvas.
 *
 * Domain adapters provide nodes, edges, renderers, and mutations. This component owns the
 * ReactFlow interaction contract so Workflow and DAG documents cannot drift into separate
 * canvas implementations.
 */
export function WorkflowCanvas({
  autoPanOnConnect,
  autoPanOnNodeDrag,
  className,
  connectOnClick = false,
  connectionLineStyle = DEFAULT_CONNECTION_LINE_STYLE,
  connectionLineType = ConnectionLineType.SmoothStep,
  deleteKeyCode,
  documentKind,
  draggable = false,
  editable = true,
  edgesFocusable,
  edgesUpdatable,
  elementsSelectable,
  elevateEdgesOnSelect = false,
  elevateNodesOnSelect = false,
  embedded = false,
  interactionMode,
  maxZoom = 1.3,
  minZoom = 0.1,
  multiSelectionKeyCode,
  nodesConnectable,
  nodesDraggable,
  onMouseDown,
  onMouseDownCapture,
  onlyRenderVisibleElements = false,
  panActivationKeyCode = DEFAULT_PAN_ACTIVATION_KEY_CODE,
  panOnDrag,
  panOnScroll = true,
  selectionKeyCode,
  selectionMode = SelectionMode.Partial,
  selectionOnDrag,
  ...surfaceProps
}: WorkflowCanvasProps) {
  const isHandMode = embedded || interactionMode === 'hand'
  const { handleMouseDown: handleSelectionMouseDown, selectionProps } =
    useCanvasSelection(isHandMode)
  const handleControlDragPan = useControlDragPan(supportsControlPan(panActivationKeyCode))

  const handleMouseDown = useCallback<NonNullable<ReactFlowProps['onMouseDown']>>(
    (event) => {
      handleSelectionMouseDown(event)
      onMouseDown?.(event)
    },
    [handleSelectionMouseDown, onMouseDown]
  )

  const handleMouseDownCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      onMouseDownCapture?.(event)
      if (!event.defaultPrevented) handleControlDragPan(event)
    },
    [handleControlDragPan, onMouseDownCapture]
  )

  return (
    <CanvasSurface
      {...surfaceProps}
      documentKind={documentKind}
      minZoom={minZoom}
      maxZoom={maxZoom}
      panOnScroll={panOnScroll}
      panActivationKeyCode={panActivationKeyCode}
      connectionLineStyle={connectionLineStyle}
      connectionLineType={connectionLineType}
      onMouseDown={handleMouseDown}
      onMouseDownCapture={handleMouseDownCapture}
      elementsSelectable={elementsSelectable ?? !embedded}
      selectionOnDrag={selectionOnDrag ?? (embedded ? false : selectionProps.selectionOnDrag)}
      selectionMode={selectionMode}
      panOnDrag={panOnDrag ?? (embedded ? true : selectionProps.panOnDrag)}
      selectionKeyCode={
        selectionKeyCode === undefined
          ? embedded
            ? null
            : selectionProps.selectionKeyCode
          : selectionKeyCode
      }
      multiSelectionKeyCode={
        multiSelectionKeyCode === undefined
          ? embedded
            ? null
            : ['Meta', 'Control', 'Shift']
          : multiSelectionKeyCode
      }
      nodesConnectable={nodesConnectable ?? (!embedded && editable)}
      connectOnClick={connectOnClick}
      nodesDraggable={nodesDraggable ?? (!embedded && editable)}
      draggable={draggable}
      noWheelClassName='allow-scroll'
      edgesFocusable={edgesFocusable ?? !embedded}
      edgesUpdatable={edgesUpdatable ?? (!embedded && editable)}
      elevateEdgesOnSelect={elevateEdgesOnSelect}
      onlyRenderVisibleElements={onlyRenderVisibleElements}
      deleteKeyCode={deleteKeyCode === undefined ? null : deleteKeyCode}
      elevateNodesOnSelect={elevateNodesOnSelect}
      autoPanOnConnect={autoPanOnConnect ?? editable}
      autoPanOnNodeDrag={autoPanOnNodeDrag ?? editable}
      className={cn(
        'workflow-container h-full bg-[var(--bg)] transition-opacity duration-150',
        isHandMode ? 'canvas-mode-hand' : 'canvas-mode-cursor',
        className
      )}
    />
  )
}
