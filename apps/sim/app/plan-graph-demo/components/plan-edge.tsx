import { cn } from '@sim/emcn'
import { type EdgeProps, getSmoothStepPath } from 'reactflow'
import type { PlanDependencyKind } from '@/app/plan-graph-demo/plan-graph-model'

export interface PlanEdgeData {
  kind: PlanDependencyKind
  satisfied: boolean
}

export function PlanEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<PlanEdgeData>) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 18,
    offset: 28,
  })

  return (
    <path
      id={id}
      d={edgePath}
      markerEnd={markerEnd}
      fill='none'
      className={cn(
        'react-flow__edge-path !stroke-[1.5px] transition-colors duration-150',
        data?.satisfied ? '!stroke-[var(--brand-accent)]' : '!stroke-[var(--text-placeholder)]',
        data?.kind === 'contract' && '[stroke-dasharray:7_5]',
        data?.kind === 'integrate-with' && '[stroke-dasharray:2_5]'
      )}
    />
  )
}
