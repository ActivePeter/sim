'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import ReactFlow, { type ReactFlowProps, useStoreApi } from 'reactflow'
import 'reactflow/dist/style.css'
import { CANVAS_FIT_VIEW_OPTIONS } from '@/components/canvas/canvas-constants'
import type { CanvasDocumentKind } from '@/lib/canvas/types'

export interface CanvasSurfaceProps extends ReactFlowProps {
  documentKind: CanvasDocumentKind
}

const logger = createLogger('CanvasSurface')
const DEFAULT_PRO_OPTIONS = { hideAttribution: true } as const

const CANVAS_SURFACE_STYLES = [
  '[&_.react-flow__handle]:!z-[30]',
  '[&_.react-flow__pane]:select-none',
  '[&_.react-flow__selectionpane]:select-none',
  String.raw`[&_.react-flow\_\_selection]:!border-[var(--text-secondary)]`,
  String.raw`[&_.react-flow\_\_selection]:!bg-[color-mix(in_oklch,var(--text-secondary)_8%,transparent)]`,
  '[&_.react-flow__background]:hidden',
].join(' ')

export function CanvasSurface({
  className,
  documentKind,
  fitViewOptions = CANVAS_FIT_VIEW_OPTIONS,
  onError,
  proOptions = DEFAULT_PRO_OPTIONS,
  ...reactFlowProps
}: CanvasSurfaceProps) {
  const store = useStoreApi()
  const [isErrorHandlerReady, setIsErrorHandlerReady] = useState(false)

  const handleError = useCallback(
    (code: string, message: string) => {
      /** ReactFlow 11 mistakes React 19's strict memo probe for a changed type map. */
      if (code === '002') return
      if (onError) {
        onError(code, message)
        return
      }
      logger.warn('React Flow reported an error', { code, documentKind, message })
    },
    [documentKind, onError]
  )

  useEffect(() => {
    const previousOnError = store.getState().onError
    store.setState({ onError: handleError })
    setIsErrorHandlerReady(true)

    return () => store.setState({ onError: previousOnError })
  }, [handleError, store])

  const surfaceClassName = cn('h-full bg-[var(--bg)]', CANVAS_SURFACE_STYLES, className)

  if (!isErrorHandlerReady) {
    return (
      <div
        aria-hidden='true'
        className={surfaceClassName}
        data-canvas-document-kind={documentKind}
      />
    )
  }

  return (
    <ReactFlow
      {...reactFlowProps}
      className={surfaceClassName}
      data-canvas-document-kind={documentKind}
      fitViewOptions={fitViewOptions}
      onError={handleError}
      proOptions={proOptions}
    />
  )
}
