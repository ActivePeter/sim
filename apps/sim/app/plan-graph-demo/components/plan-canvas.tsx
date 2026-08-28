'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  type Edge,
  type EdgeTypes,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeTypes,
  SelectionMode,
} from 'reactflow'
import { type CanvasInteractionMode, CanvasSurface } from '@/components/canvas'
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

const NODE_TYPES: NodeTypes = { planNode: PlanNodeCard }
const EDGE_TYPES: EdgeTypes = { planEdge: PlanEdge }

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
  const [positions, setPositions] = useState<Record<string, PlanPosition>>({
    ...INITIAL_PLAN_POSITIONS,
  })
  const [canvasMode, setCanvasMode] = useState<CanvasInteractionMode>('hand')
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

  return (
    <div className='relative h-full min-h-0 w-full'>
      <CanvasSurface
        documentKind='roadmap'
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
        panOnDrag={canvasMode === 'hand'}
        selectionOnDrag={canvasMode === 'cursor'}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={canvasMode === 'cursor' ? 'Shift' : null}
        nodesConnectable={false}
        elementsSelectable
        nodesDraggable
        edgesFocusable={false}
        className='workflow-container [&_.react-flow__pane:active]:cursor-grabbing [&_.react-flow__pane]:cursor-grab'
      >
        <CanvasControls mode={canvasMode} onModeChange={setCanvasMode} />
      </CanvasSurface>
    </div>
  )
}
