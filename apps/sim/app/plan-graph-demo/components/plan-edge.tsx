import { WorkflowEdgeView } from '@sim/workflow-renderer'
import type { EdgeProps } from 'reactflow'
import type { PlanDependencyKind } from '@/app/plan-graph-demo/plan-graph-model'

export interface PlanEdgeData {
  kind: PlanDependencyKind
  satisfied: boolean
}

/** Projects DAG dependency state onto the same edge renderer used by Workflow. */
export function PlanEdge(props: EdgeProps<PlanEdgeData>) {
  const strokeDasharray =
    props.data?.kind === 'contract'
      ? '7 5'
      : props.data?.kind === 'integrate-with'
        ? '2 5'
        : undefined

  return (
    <WorkflowEdgeView
      {...props}
      style={{ ...props.style, strokeDasharray }}
      diffStatus={null}
      runStatus={props.data?.satisfied ? 'success' : undefined}
      isPreviewRun={false}
      isWorkflowRunning={props.animated}
      isTargetActive={props.animated}
      isConnectedToSelection={Boolean(props.selected)}
    />
  )
}
