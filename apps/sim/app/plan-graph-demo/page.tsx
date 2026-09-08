import { redirect } from 'next/navigation'

/** Compatibility entry point; the workspace DAG index discovers persisted documents. */
export default function DagEntryPage() {
  const workspaceId = process.env.PLAN_GRAPH_DEMO_WORKSPACE_ID
  redirect(workspaceId ? `/workspace/${encodeURIComponent(workspaceId)}/d` : '/workspace')
}
