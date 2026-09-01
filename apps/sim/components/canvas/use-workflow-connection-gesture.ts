'use client'

import { useCallback, useEffect, useRef } from 'react'
import { EDGE_Z_MAX } from '@sim/workflow-renderer'
import { WORKFLOW_SOURCE_HANDLE_ID, WORKFLOW_TARGET_HANDLE_ID } from '@sim/workflow-types/workflow'
import type { Connection, Node, OnConnect, OnConnectStart } from 'reactflow'

export const WORKFLOW_CONNECTION_CONTAINER_CLASSNAME =
  '[--connection-line-stroke:var(--text-secondary)] data-[connection-line=error]:[--connection-line-stroke:var(--text-error)] data-[connection-active=true]:[&_.react-flow__handle.source]:pointer-events-none'

/** Keeps the in-flight edge above resting edges and below Workflow cards. */
export const WORKFLOW_CONNECTION_LINE_CONTAINER_STYLE = { zIndex: EDGE_Z_MAX }

export interface WorkflowConnectionSource {
  handleId: string | null
  nodeId: string
}

export interface WorkflowConnectionPaneDrop {
  clientX: number
  clientY: number
  source: WorkflowConnectionSource
}

interface UseWorkflowConnectionGestureOptions<NodeData, ElementType extends HTMLElement> {
  canvasContainerRef: React.RefObject<ElementType | null>
  commitConnection: (connection: Connection) => boolean
  getConnectionLineState?: (source: WorkflowConnectionSource) => string
  getNodes: () => Node<NodeData>[]
  isNodeBodyTarget?: (node: Node<NodeData>) => boolean
  normalizeSourceHandle?: (source: WorkflowConnectionSource) => string
  onConnectionStart?: (source: WorkflowConnectionSource) => void
  onPaneDrop?: (drop: WorkflowConnectionPaneDrop) => void
}

interface UseWorkflowConnectionGestureResult {
  onConnect: OnConnect
  onConnectEnd: (event: MouseEvent | TouchEvent) => void
  onConnectStart: OnConnectStart
}

/**
 * Owns Workflow's complete connection gesture lifecycle for every editable graph document.
 *
 * Domain adapters only validate and persist a completed connection. Hit testing, handle-to-body
 * drops, Escape cancellation, and the parent container's visual state stay identical everywhere.
 */
export function useWorkflowConnectionGesture<
  NodeData = unknown,
  ElementType extends HTMLElement = HTMLDivElement,
>({
  canvasContainerRef,
  commitConnection,
  getConnectionLineState,
  getNodes,
  isNodeBodyTarget,
  normalizeSourceHandle,
  onConnectionStart,
  onPaneDrop,
}: UseWorkflowConnectionGestureOptions<NodeData, ElementType>): UseWorkflowConnectionGestureResult {
  const connectionSourceRef = useRef<WorkflowConnectionSource | null>(null)
  const connectionCompletedRef = useRef(false)
  const connectionCancelledRef = useRef(false)

  const findNodeAtScreenPosition = useCallback(
    (clientX: number, clientY: number) => {
      const nodes = getNodes()
      for (const element of document.elementsFromPoint(clientX, clientY)) {
        const nodeElement = element.closest<HTMLElement>('.react-flow__node')
        const nodeId = nodeElement?.getAttribute('data-id')
        if (!nodeId) continue

        const node = nodes.find((candidate) => candidate.id === nodeId)
        if (node && (!isNodeBodyTarget || isNodeBodyTarget(node))) return node
      }
      return undefined
    },
    [getNodes, isNodeBodyTarget]
  )

  const handleConnectionEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !connectionSourceRef.current) return
    event.preventDefault()
    event.stopPropagation()
    connectionCancelledRef.current = true
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  }, [])

  useEffect(
    () => () => window.removeEventListener('keydown', handleConnectionEscape, true),
    [handleConnectionEscape]
  )

  const onConnectStart = useCallback<OnConnectStart>(
    (_event, params) => {
      if (!params.nodeId) return

      const source = { nodeId: params.nodeId, handleId: params.handleId }
      canvasContainerRef.current?.setAttribute('data-connection-active', 'true')
      canvasContainerRef.current?.setAttribute(
        'data-connection-line',
        getConnectionLineState?.(source) ?? 'default'
      )
      connectionSourceRef.current = source
      connectionCompletedRef.current = false
      connectionCancelledRef.current = false
      onConnectionStart?.(source)
      window.addEventListener('keydown', handleConnectionEscape, true)
    },
    [canvasContainerRef, getConnectionLineState, handleConnectionEscape, onConnectionStart]
  )

  const onConnect = useCallback<OnConnect>(
    (connection) => {
      if (connectionCancelledRef.current || !connection.source || !connection.target) return
      connectionCompletedRef.current = commitConnection(connection)
    },
    [commitConnection]
  )

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      window.removeEventListener('keydown', handleConnectionEscape, true)
      canvasContainerRef.current?.setAttribute('data-connection-line', 'default')
      canvasContainerRef.current?.setAttribute('data-connection-active', 'false')

      const source = connectionSourceRef.current
      if (!source || connectionCancelledRef.current || connectionCompletedRef.current) {
        connectionSourceRef.current = null
        return
      }

      const clientPosition = 'changedTouches' in event ? event.changedTouches[0] : event
      const sourceHandle =
        normalizeSourceHandle?.(source) ?? source.handleId ?? WORKFLOW_SOURCE_HANDLE_ID
      const normalizedSource = { ...source, handleId: sourceHandle }
      const targetNode = findNodeAtScreenPosition(clientPosition.clientX, clientPosition.clientY)

      if (targetNode && targetNode.id !== source.nodeId) {
        onConnect({
          source: source.nodeId,
          sourceHandle,
          target: targetNode.id,
          targetHandle: WORKFLOW_TARGET_HANDLE_ID,
        })
      } else if (!targetNode) {
        onPaneDrop?.({
          clientX: clientPosition.clientX,
          clientY: clientPosition.clientY,
          source: normalizedSource,
        })
      }

      connectionSourceRef.current = null
    },
    [
      canvasContainerRef,
      findNodeAtScreenPosition,
      handleConnectionEscape,
      normalizeSourceHandle,
      onConnect,
      onPaneDrop,
    ]
  )

  return { onConnect, onConnectEnd, onConnectStart }
}
