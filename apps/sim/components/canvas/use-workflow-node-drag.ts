'use client'

import { useCallback, useRef } from 'react'
import type { Node } from 'reactflow'

type NodeDragHandler<NodeType extends Node> = (event: React.MouseEvent, node: NodeType) => void
type SelectionDragHandler<NodeType extends Node> = (
  event: React.MouseEvent,
  nodes: NodeType[]
) => void

interface UseWorkflowNodeDragOptions<NodeType extends Node> {
  dragInProgressRef?: React.MutableRefObject<boolean>
  getNodeParentId?: (node: NodeType) => string | undefined
  getNodeSelectionContextId?: (node: NodeType) => string | null
  getNodes: () => NodeType[]
  onNodeDragStart?: NodeDragHandler<NodeType>
  onNodeDragStop?: NodeDragHandler<NodeType>
  onSelectionDragStart?: SelectionDragHandler<NodeType>
  onSelectionDragStop?: SelectionDragHandler<NodeType>
  setNodes: React.Dispatch<React.SetStateAction<NodeType[]>>
}

interface UseWorkflowNodeDragResult<NodeType extends Node> {
  dragInProgressRef: React.MutableRefObject<boolean>
  onNodeDragStart: NodeDragHandler<NodeType>
  onNodeDragStop: NodeDragHandler<NodeType>
  onSelectionDragStart: SelectionDragHandler<NodeType>
  onSelectionDragStop: SelectionDragHandler<NodeType>
}

/**
 * Applies Workflow's shared node-drag lifecycle around domain-specific persistence callbacks.
 *
 * In particular, React Flow deselects an already-selected node at the start of a Shift-drag. The
 * shared wrapper restores it when it belongs to the same selection context, preserving group drag.
 */
export function useWorkflowNodeDrag<NodeType extends Node>({
  dragInProgressRef: providedDragInProgressRef,
  getNodeParentId,
  getNodeSelectionContextId,
  getNodes,
  onNodeDragStart: handleNodeDragStart,
  onNodeDragStop: handleNodeDragStop,
  onSelectionDragStart: handleSelectionDragStart,
  onSelectionDragStop: handleSelectionDragStop,
  setNodes,
}: UseWorkflowNodeDragOptions<NodeType>): UseWorkflowNodeDragResult<NodeType> {
  const internalDragInProgressRef = useRef(false)
  const dragInProgressRef = providedDragInProgressRef ?? internalDragInProgressRef

  const onNodeDragStart = useCallback<NodeDragHandler<NodeType>>(
    (event, node) => {
      dragInProgressRef.current = true
      const allNodes = getNodes()
      const selectedNodes = allNodes.filter((candidate) => candidate.selected)
      const draggedNode = allNodes.find((candidate) => candidate.id === node.id)

      handleNodeDragStart?.(event, node)

      if (!draggedNode || draggedNode.selected || selectedNodes.length === 0) return
      const parentId = getNodeParentId?.(draggedNode)
      const parentIsSelected = Boolean(
        parentId && selectedNodes.some((candidate) => candidate.id === parentId)
      )
      const contextMismatch = Boolean(
        getNodeSelectionContextId &&
          getNodeSelectionContextId(draggedNode) !== getNodeSelectionContextId(selectedNodes[0])
      )
      if (parentIsSelected || contextMismatch) return

      setNodes((currentNodes) =>
        currentNodes.map((candidate) =>
          candidate.id === node.id ? { ...candidate, selected: true } : candidate
        )
      )
    },
    [getNodeParentId, getNodeSelectionContextId, getNodes, handleNodeDragStart, setNodes]
  )

  const onNodeDragStop = useCallback<NodeDragHandler<NodeType>>(
    (event, node) => {
      handleNodeDragStop?.(event, node)
      dragInProgressRef.current = false
    },
    [handleNodeDragStop]
  )

  const onSelectionDragStart = useCallback<SelectionDragHandler<NodeType>>(
    (event, nodes) => {
      dragInProgressRef.current = true
      handleSelectionDragStart?.(event, nodes)
    },
    [handleSelectionDragStart]
  )

  const onSelectionDragStop = useCallback<SelectionDragHandler<NodeType>>(
    (event, nodes) => {
      handleSelectionDragStop?.(event, nodes)
      dragInProgressRef.current = false
    },
    [handleSelectionDragStop]
  )

  return {
    dragInProgressRef,
    onNodeDragStart,
    onNodeDragStop,
    onSelectionDragStart,
    onSelectionDragStop,
  }
}
