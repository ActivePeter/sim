'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import { ConnectionLineType, type ReactFlowProps, SelectionMode } from 'reactflow'
import type { CanvasInteractionMode } from '@/components/canvas/canvas-action-bar'
import { CanvasSurface, type CanvasSurfaceProps } from '@/components/canvas/canvas-surface'
import type { CanvasDocumentKind } from '@/lib/canvas/types'

const DEFAULT_CONNECTION_LINE_STYLE = {
  stroke: 'var(--connection-line-stroke, var(--text-secondary))',
  strokeWidth: 2,
} as const

interface CanvasSelectionProps {
  panOnDrag: number[]
  selectionKeyCode: string | null
  selectionOnDrag: boolean
}

interface UseCanvasSelectionResult {
  handleMouseDown: NonNullable<ReactFlowProps['onMouseDown']>
  selectionProps: CanvasSelectionProps
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
 * ReactFlow interaction contract so Workflow and Roadmap documents cannot drift into separate
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
  onlyRenderVisibleElements = false,
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

  const handleMouseDown = useCallback<NonNullable<ReactFlowProps['onMouseDown']>>(
    (event) => {
      handleSelectionMouseDown(event)
      onMouseDown?.(event)
    },
    [handleSelectionMouseDown, onMouseDown]
  )

  return (
    <CanvasSurface
      {...surfaceProps}
      documentKind={documentKind}
      minZoom={minZoom}
      maxZoom={maxZoom}
      panOnScroll={panOnScroll}
      connectionLineStyle={connectionLineStyle}
      connectionLineType={connectionLineType}
      onMouseDown={handleMouseDown}
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
