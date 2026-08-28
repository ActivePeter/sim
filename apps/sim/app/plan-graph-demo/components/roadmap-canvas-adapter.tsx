'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  type Connection,
  type Edge,
  type EdgeTypes,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeTypes,
} from 'reactflow'
import { type CanvasInteractionMode, WorkflowCanvas } from '@/components/canvas'
import { CanvasControls } from '@/app/plan-graph-demo/components/canvas-controls'
import { PlanEdge, type PlanEdgeData } from '@/app/plan-graph-demo/components/plan-edge'
import { PlanNodeCard, type PlanNodeData } from '@/app/plan-graph-demo/components/plan-node-card'
import {
  isDependencySatisfied,
  type PlanDependency,
  type PlanItem,
  type PlanPosition,
  type ResolvedPlanItem,
} from '@/app/plan-graph-demo/plan-graph-model'

const ROADMAP_NODE_TYPES: NodeTypes = { roadmapNode: PlanNodeCard }
const ROADMAP_EDGE_TYPES: EdgeTypes = { roadmapEdge: PlanEdge }

interface RoadmapCanvasAdapterProps {
  dependencies: readonly PlanDependency[]
  items: readonly PlanItem[]
  onConnectItems: (sourceId: string, targetId: string) => void
  onPositionsChange: (positions: Record<string, PlanPosition>) => void
  onSelectItem: (itemId: string) => void
  positions: Readonly<Record<string, PlanPosition>>
  resolvedItems: readonly ResolvedPlanItem[]
  selectedItemId: string
}

/** Maps the Plan Graph domain to node and edge types consumed by the shared WorkflowCanvas. */
export function RoadmapCanvasAdapter({
  dependencies,
  items,
  onConnectItems,
  onPositionsChange,
  onSelectItem,
  positions,
  resolvedItems,
  selectedItemId,
}: RoadmapCanvasAdapterProps) {
  const [canvasMode, setCanvasMode] = useState<CanvasInteractionMode>('hand')
  const nodes = useMemo<Node<PlanNodeData>[]>(
    () =>
      resolvedItems.map((item) => ({
        id: item.id,
        type: 'roadmapNode',
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
        type: 'roadmapEdge',
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: items.find((item) => item.id === dependency.source)?.lifecycle === 'active',
        data: {
          kind: dependency.kind,
          satisfied: isDependencySatisfied(dependency, items),
        },
      })),
    [dependencies, items]
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges = changes.filter(
        (change) => change.type === 'position' && change.position
      )
      if (positionChanges.length === 0) return

      const next = { ...positions }
      for (const change of positionChanges) {
        if (change.type === 'position' && change.position) {
          next[change.id] = change.position
        }
      }
      onPositionsChange(next)
    },
    [onPositionsChange, positions]
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return
      onConnectItems(connection.source, connection.target)
    },
    [onConnectItems]
  )

  return (
    <div className='relative h-full min-h-0 w-full'>
      <WorkflowCanvas
        documentKind='roadmap'
        interactionMode={canvasMode}
        editable
        nodes={nodes}
        edges={edges}
        nodeTypes={ROADMAP_NODE_TYPES}
        edgeTypes={ROADMAP_EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onConnect={handleConnect}
        onNodeClick={(_event, node) => onSelectItem(node.id)}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      >
        <CanvasControls mode={canvasMode} onModeChange={setCanvasMode} />
      </WorkflowCanvas>
    </div>
  )
}
