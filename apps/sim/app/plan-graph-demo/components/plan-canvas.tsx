'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import type { Edge, EdgeTypes, Node, NodeChange, NodeTypes } from 'reactflow'
import ReactFlow, { MarkerType, useStoreApi } from 'reactflow'
import 'reactflow/dist/style.css'
import { CanvasControls } from '@/app/plan-graph-demo/components/canvas-controls'
import { PlanEdge, type PlanEdgeData } from '@/app/plan-graph-demo/components/plan-edge'
import { PlanNodeCard, type PlanNodeData } from '@/app/plan-graph-demo/components/plan-node-card'
import {
  INITIAL_PLAN_POSITIONS,
  isDependencySatisfied,
  type PlanDependency,
  type PlanItem,
  type PlanPosition,
  type ResolvedPlanItem,
} from '@/app/plan-graph-demo/plan-graph-model'

const PRO_OPTIONS = { hideAttribution: true } as const
const NODE_TYPES: NodeTypes = { planNode: PlanNodeCard }
const EDGE_TYPES: EdgeTypes = { planEdge: PlanEdge }
const logger = createLogger('PlanGraphCanvas')

/**
 * ReactFlow 11 misreports error 002 when React 19 Strict Mode double-invokes memo initializers.
 */
function handleReactFlowError(code: string, message: string) {
  if (code === '002') return
  logger.warn('React Flow reported an error', { code, message })
}

interface PlanCanvasProps {
  dependencies: readonly PlanDependency[]
  items: readonly PlanItem[]
  resolvedItems: readonly ResolvedPlanItem[]
  selectedItemId: string
  onSelectItem: (itemId: string) => void
}

export function PlanCanvas({
  dependencies,
  items,
  resolvedItems,
  selectedItemId,
  onSelectItem,
}: PlanCanvasProps) {
  const store = useStoreApi()
  const [positions, setPositions] = useState<Record<string, PlanPosition>>({
    ...INITIAL_PLAN_POSITIONS,
  })
  const [isErrorHandlerReady, setIsErrorHandlerReady] = useState(false)
  const nodes = useMemo<Node<PlanNodeData>[]>(
    () =>
      resolvedItems.map((item) => ({
        id: item.id,
        type: 'planNode',
        position: positions[item.id] ?? { x: 0, y: 0 },
        data: { item },
        selected: item.id === selectedItemId,
      })),
    [positions, resolvedItems, selectedItemId]
  )

  const edges = useMemo<Edge<PlanEdgeData>[]>(
    () =>
      dependencies.map((dependency) => ({
        id: dependency.id,
        source: dependency.source,
        target: dependency.target,
        type: 'planEdge',
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: items.find((item) => item.id === dependency.source)?.lifecycle === 'active',
        data: {
          kind: dependency.kind,
          satisfied: isDependencySatisfied(dependency, items),
        },
      })),
    [dependencies, items]
  )

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    const positionChanges = changes.filter(
      (change) => change.type === 'position' && change.position
    )
    if (positionChanges.length === 0) return

    setPositions((current) => {
      const next = { ...current }
      for (const change of positionChanges) {
        if (change.type === 'position' && change.position) {
          next[change.id] = change.position
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    const previousOnError = store.getState().onError
    store.setState({ onError: handleReactFlowError })
    setIsErrorHandlerReady(true)

    return () => store.setState({ onError: previousOnError })
  }, [store])

  if (!isErrorHandlerReady) {
    return <div className='h-full min-h-0 w-full bg-[var(--bg)]' />
  }

  return (
    <div className='relative h-full min-h-0 w-full bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px]'>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onNodeClick={(_event, node) => onSelectItem(node.id)}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.35}
        maxZoom={1.35}
        panOnScroll
        nodesConnectable={false}
        elementsSelectable
        nodesDraggable
        edgesFocusable={false}
        onError={handleReactFlowError}
        proOptions={PRO_OPTIONS}
        className='bg-transparent [&_.react-flow__pane:active]:cursor-grabbing [&_.react-flow__pane]:cursor-grab'
      >
        <CanvasControls />
      </ReactFlow>
    </div>
  )
}
