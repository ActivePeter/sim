'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BLOCK_Z_BASE, getBlockZIndex, getEdgeZIndex } from '@sim/workflow-renderer'
import { WORKFLOW_SOURCE_HANDLE_ID, WORKFLOW_TARGET_HANDLE_ID } from '@sim/workflow-types/workflow'
import {
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type NodeTypes,
  type ReactFlowInstance,
  useReactFlow,
} from 'reactflow'
import {
  type CanvasInteractionMode,
  reconcileCanvasEdges,
  reconcileCanvasNodes,
  useWorkflowConnectionGesture,
  useWorkflowNodeDrag,
  WORKFLOW_CONNECTION_CONTAINER_CLASSNAME,
  WORKFLOW_CONNECTION_LINE_CONTAINER_STYLE,
  WorkflowCanvas,
} from '@/components/canvas'
import { CanvasControls } from '@/app/plan-graph-demo/components/canvas-controls'
import { PlanEdge, type PlanEdgeData } from '@/app/plan-graph-demo/components/plan-edge'
import { PlanNodeCard, type PlanNodeData } from '@/app/plan-graph-demo/components/plan-node-card'
import {
  DEFAULT_PLAN_NODE_SIZE,
  type PlanDependency,
  type PlanItem,
  type PlanPosition,
  type PlanSize,
  type ResolvedPlanItem,
  wouldCreateDagCycle,
} from '@/app/plan-graph-demo/plan-graph-model'
import {
  reactFlowFitViewOptions,
  reactFlowProOptions,
  reactFlowStyles,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-constants'
import { useSnapToGridSize } from '@/hooks/queries/general-settings'

const DAG_NODE_TYPES: NodeTypes = { dagNode: PlanNodeCard }
const DAG_EDGE_TYPES: EdgeTypes = { dagEdge: PlanEdge }
const DAG_FIT_VIEW_OPTIONS = { ...reactFlowFitViewOptions, padding: 0.18 } as const

interface DagCanvasAdapterProps {
  dependencies: readonly PlanDependency[]
  items: readonly PlanItem[]
  onConnectItems: (sourceId: string, targetId: string) => void
  onItemResize: (itemId: string, position: PlanPosition, size: PlanSize) => void
  onPositionsChange: (positions: Record<string, PlanPosition>) => void
  onRemoveDependency: (dependencyId: string) => void
  onRemoveItem: (itemId: string) => void
  onSelectItem: (itemId: string) => void
  positions: Readonly<Record<string, PlanPosition>>
  repository: string
  resolvedItems: readonly ResolvedPlanItem[]
  selectedItemId: string
  sizes: Readonly<Record<string, PlanSize>>
}

/** Adapts DAG persistence to the complete flat-graph interaction contract used by Workflow. */
export function DagCanvasAdapter({
  dependencies,
  items,
  onConnectItems,
  onItemResize,
  onPositionsChange,
  onRemoveDependency,
  onRemoveItem,
  onSelectItem,
  positions,
  repository,
  resolvedItems,
  selectedItemId,
  sizes,
}: DagCanvasAdapterProps) {
  const [canvasMode, setCanvasMode] = useState<CanvasInteractionMode>('hand')
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(() => new Set())
  const [lastInteractedNodeId, setLastInteractedNodeId] = useState<string | null>(selectedItemId)
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const dragInProgressRef = useRef(false)
  const initializedRef = useRef(false)
  const previousEdgesRef = useRef<Edge<PlanEdgeData>[]>([])
  const reactFlowInstance = useReactFlow<PlanNodeData, PlanEdgeData>()
  const snapToGridSize = useSnapToGridSize()
  const snapToGrid = snapToGridSize > 0
  const snapGrid = useMemo<[number, number]>(
    () => [snapToGridSize, snapToGridSize],
    [snapToGridSize]
  )

  const derivedNodes = useMemo<Node<PlanNodeData>[]>(
    () =>
      resolvedItems.map((item) => {
        const artifactRepository = item.repository ?? repository
        const size = sizes[item.id] ?? DEFAULT_PLAN_NODE_SIZE
        return {
          id: item.id,
          type: 'dagNode',
          position: positions[item.id] ?? { x: 0, y: 0 },
          dragHandle: '.workflow-drag-handle',
          draggable: true,
          style: { height: size.height, width: size.width },
          zIndex: BLOCK_Z_BASE,
          data: {
            canRemove: items.length > 1,
            issueUrl:
              item.issue.url ??
              (item.issue.number === null
                ? undefined
                : `https://github.com/${artifactRepository}/issues/${item.issue.number}`),
            item,
            onResize: (position, nextSize) => onItemResize(item.id, position, nextSize),
            onRemove: () => onRemoveItem(item.id),
            onSelect: () => onSelectItem(item.id),
            pullRequestUrl:
              item.primaryPr.url ??
              (item.primaryPr.number === null
                ? undefined
                : `https://github.com/${artifactRepository}/pull/${item.primaryPr.number}`),
            wouldCreateConnectionCycle: (source, target) =>
              wouldCreateDagCycle(dependencies, source, target),
            size,
          },
          selected: false,
        }
      }),
    [
      dependencies,
      items.length,
      onItemResize,
      onRemoveItem,
      onSelectItem,
      positions,
      repository,
      resolvedItems,
      sizes,
    ]
  )

  const [displayNodes, setDisplayNodes] = useState<Node<PlanNodeData>[]>(derivedNodes)

  useEffect(() => {
    setDisplayNodes((currentNodes) => {
      const reconciled = reconcileCanvasNodes(currentNodes, derivedNodes)
      if (reconciled.some((node) => node.id === selectedItemId && node.selected)) {
        return reconciled
      }
      return reconciled.map((node) => ({ ...node, selected: node.id === selectedItemId }))
    })
  }, [derivedNodes, selectedItemId])

  const persistNodePositions = useCallback(
    (nodes: readonly Pick<Node, 'id' | 'position'>[]) => {
      const nextPositions = { ...positions }
      let changed = false
      for (const node of nodes) {
        const current = nextPositions[node.id]
        if (!current || current.x !== node.position.x || current.y !== node.position.y) {
          nextPositions[node.id] = { x: node.position.x, y: node.position.y }
          changed = true
        }
      }
      if (changed) onPositionsChange(nextPositions)
    },
    [onPositionsChange, positions]
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setDisplayNodes((currentNodes) => applyNodeChanges(changes, currentNodes))

      const isResizeFrame = changes.some(
        (change) => change.type === 'dimensions' && change.resizing === true
      )

      const selectedChange = [...changes]
        .reverse()
        .find(
          (change): change is NodeChange & { id: string; selected: boolean } =>
            change.type === 'select' && change.selected
        )
      if (selectedChange) onSelectItem(selectedChange.id)

      if (!dragInProgressRef.current && !isResizeFrame) {
        const keyboardMoves: Pick<Node, 'id' | 'position'>[] = []
        for (const change of changes) {
          if (change.type === 'position' && !change.dragging && change.position) {
            keyboardMoves.push({ id: change.id, position: change.position })
          }
        }
        if (keyboardMoves.length > 0) persistNodePositions(keyboardMoves)
      }
    },
    [onSelectItem, persistNodePositions]
  )

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey
      setLastInteractedNodeId(node.id)
      setDisplayNodes((currentNodes) =>
        currentNodes.map((currentNode) => ({
          ...currentNode,
          selected: isMultiSelect
            ? currentNode.id === node.id
              ? true
              : currentNode.selected
            : currentNode.id === node.id,
        }))
      )
      onSelectItem(node.id)
    },
    [onSelectItem]
  )

  const handleNodeDragStart = useCallback<NodeMouseHandler>((_event, node) => {
    setLastInteractedNodeId(node.id)
  }, [])

  const handleNodeDragStop = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const selectedNodes = reactFlowInstance.getNodes().filter((candidate) => candidate.selected)
      persistNodePositions(selectedNodes.length > 1 ? selectedNodes : [node])
    },
    [persistNodePositions, reactFlowInstance]
  )

  const handleSelectionDragStop = useCallback(
    (_event: React.MouseEvent, nodes: Node[]) => {
      persistNodePositions(nodes)
    },
    [persistNodePositions]
  )

  const handleRemoveEdge = useCallback(
    (edgeId: string) => {
      onRemoveDependency(edgeId)
      setSelectedEdgeIds((current) => {
        if (!current.has(edgeId)) return current
        const next = new Set(current)
        next.delete(edgeId)
        return next
      })
    },
    [onRemoveDependency]
  )

  const selectedNodeIds = useMemo(
    () => new Set(displayNodes.filter((node) => node.selected).map((node) => node.id)),
    [displayNodes]
  )

  const edges = useMemo<Edge<PlanEdgeData>[]>(() => {
    const projected = dependencies.map((dependency) => {
      const isConnectedToSelection =
        selectedNodeIds.has(dependency.source) || selectedNodeIds.has(dependency.target)
      const isSelected = selectedEdgeIds.has(dependency.id)
      return {
        id: dependency.id,
        source: dependency.source,
        sourceHandle: WORKFLOW_SOURCE_HANDLE_ID,
        target: dependency.target,
        targetHandle: WORKFLOW_TARGET_HANDLE_ID,
        type: 'dagEdge',
        zIndex: getEdgeZIndex(undefined, {
          isHighlighted: isConnectedToSelection || isSelected,
        }),
        data: {
          isConnectedToSelection,
          isSelected,
          onDelete: handleRemoveEdge,
        },
      }
    })
    const reconciled = reconcileCanvasEdges(previousEdgesRef.current, projected)
    previousEdgesRef.current = reconciled
    return reconciled
  }, [dependencies, handleRemoveEdge, selectedEdgeIds, selectedNodeIds])

  const nodes = useMemo(
    () =>
      displayNodes.map((node) => {
        const zIndex = getBlockZIndex(BLOCK_Z_BASE, {
          isLastInteracted: node.id === lastInteractedNodeId,
          isSelected: node.selected,
        })
        return zIndex === node.zIndex ? node : { ...node, zIndex }
      }),
    [displayNodes, lastInteractedNodeId]
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') handleRemoveEdge(change.id)
      }
    },
    [handleRemoveEdge]
  )

  const handleEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.stopPropagation()
    setSelectedEdgeIds((current) => {
      if (!event.shiftKey) return new Set([edge.id])
      const next = new Set(current)
      if (next.has(edge.id)) next.delete(edge.id)
      else next.add(edge.id)
      return next
    })
  }, [])

  const handlePaneClick = useCallback(() => {
    setSelectedEdgeIds(new Set())
  }, [])

  const commitConnection = useCallback(
    (connection: { source: string | null; target: string | null }) => {
      if (!connection.source || !connection.target) return false
      onConnectItems(connection.source, connection.target)
      return true
    },
    [onConnectItems]
  )

  const {
    onConnect: handleConnect,
    onConnectEnd: handleConnectEnd,
    onConnectStart: handleConnectStart,
  } = useWorkflowConnectionGesture({
    canvasContainerRef,
    commitConnection,
    getNodes: reactFlowInstance.getNodes,
  })

  const { onNodeDragStart, onNodeDragStop, onSelectionDragStart, onSelectionDragStop } =
    useWorkflowNodeDrag({
      dragInProgressRef,
      getNodes: reactFlowInstance.getNodes,
      onNodeDragStart: handleNodeDragStart,
      onNodeDragStop: handleNodeDragStop,
      onSelectionDragStop: handleSelectionDragStop,
      setNodes: setDisplayNodes,
    })

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    if (initializedRef.current) return
    initializedRef.current = true
    requestAnimationFrame(() => instance.fitView(DAG_FIT_VIEW_OPTIONS))
  }, [])

  return (
    <div
      ref={canvasContainerRef}
      className={`relative h-full min-h-0 w-full ${WORKFLOW_CONNECTION_CONTAINER_CLASSNAME}`}
      data-connection-active='false'
    >
      <WorkflowCanvas
        documentKind='dag'
        interactionMode={canvasMode}
        editable
        nodes={nodes}
        edges={edges}
        nodeTypes={DAG_NODE_TYPES}
        edgeTypes={DAG_EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onSelectionDragStart}
        onSelectionDragStop={onSelectionDragStop}
        onInit={handleInit}
        fitViewOptions={DAG_FIT_VIEW_OPTIONS}
        proOptions={reactFlowProOptions}
        connectionLineContainerStyle={WORKFLOW_CONNECTION_LINE_CONTAINER_STYLE}
        className={reactFlowStyles}
        snapToGrid={snapToGrid}
        snapGrid={snapGrid}
      >
        <CanvasControls mode={canvasMode} onModeChange={setCanvasMode} />
      </WorkflowCanvas>
    </div>
  )
}
