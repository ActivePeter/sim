'use client'

import { useCallback, useMemo, useState } from 'react'
import type { Connection, Edge, EdgeTypes, Node, NodeChange, NodeTypes } from 'reactflow'
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
  wouldCreateDagCycle,
} from '@/app/plan-graph-demo/plan-graph-model'

const DAG_NODE_TYPES: NodeTypes = { dagNode: PlanNodeCard }
const DAG_EDGE_TYPES: EdgeTypes = { dagEdge: PlanEdge }

interface DagCanvasAdapterProps {
  dependencies: readonly PlanDependency[]
  items: readonly PlanItem[]
  onAdvanceItem: (itemId: string) => void
  onConnectItems: (sourceId: string, targetId: string) => void
  onPositionsChange: (positions: Record<string, PlanPosition>) => void
  onRemoveItem: (itemId: string) => void
  onSelectItem: (itemId: string) => void
  positions: Readonly<Record<string, PlanPosition>>
  repository: string
  resolvedItems: readonly ResolvedPlanItem[]
  selectedItemId: string
}

/** Maps the Plan Graph domain to node and edge types consumed by the shared WorkflowCanvas. */
export function DagCanvasAdapter({
  dependencies,
  items,
  onAdvanceItem,
  onConnectItems,
  onPositionsChange,
  onRemoveItem,
  onSelectItem,
  positions,
  repository,
  resolvedItems,
  selectedItemId,
}: DagCanvasAdapterProps) {
  const [canvasMode, setCanvasMode] = useState<CanvasInteractionMode>('hand')
  const nodes = useMemo<Node<PlanNodeData>[]>(
    () =>
      resolvedItems.map((item) => ({
        id: item.id,
        type: 'dagNode',
        position: positions[item.id] ?? { x: 0, y: 0 },
        data: {
          canRemove: items.length > 1,
          issueUrl: `https://github.com/${repository}/issues/${item.issue.number}`,
          item,
          onAdvance: () => onAdvanceItem(item.id),
          onRemove: () => onRemoveItem(item.id),
          onSelect: () => onSelectItem(item.id),
          pullRequestUrl:
            item.primaryPr.number === null
              ? undefined
              : `https://github.com/${repository}/pull/${item.primaryPr.number}`,
          wouldCreateConnectionCycle: (source, target) =>
            wouldCreateDagCycle(dependencies, source, target),
        },
        selected: item.id === selectedItemId,
      })),
    [
      dependencies,
      items.length,
      onAdvanceItem,
      onRemoveItem,
      onSelectItem,
      positions,
      repository,
      resolvedItems,
      selectedItemId,
    ]
  )

  const edges = useMemo<Edge<PlanEdgeData>[]>(
    () =>
      dependencies.map((dependency) => ({
        id: dependency.id,
        source: dependency.source,
        target: dependency.target,
        type: 'dagEdge',
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
        documentKind='dag'
        interactionMode={canvasMode}
        editable
        nodes={nodes}
        edges={edges}
        nodeTypes={DAG_NODE_TYPES}
        edgeTypes={DAG_EDGE_TYPES}
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
