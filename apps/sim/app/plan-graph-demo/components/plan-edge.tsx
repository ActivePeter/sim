import { WorkflowEdgeView } from '@sim/workflow-renderer'
import type { EdgeProps } from 'reactflow'

export interface PlanEdgeData {
  isConnectedToSelection: boolean
  isSelected: boolean
  onDelete: (edgeId: string) => void
}

/** Adds DAG data to the unmodified resting Workflow edge treatment. */
export function PlanEdge(props: EdgeProps<PlanEdgeData>) {
  return (
    <WorkflowEdgeView
      {...props}
      diffStatus={null}
      runStatus={undefined}
      isPreviewRun={false}
      isConnectedToSelection={Boolean(props.data?.isConnectedToSelection)}
    />
  )
}
