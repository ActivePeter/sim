import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DEFAULT_DEMO_DAG_ID } from '@/lib/dags/demo-catalog'
import { DagDemo } from '@/app/plan-graph-demo/plan-graph-demo'

export const metadata: Metadata = {
  title: 'Agent DAG Demo | Sim',
  description:
    'A DAG canvas for human-authored PR dependencies executed by multiple coding agents.',
}

export default function DagDemoPage() {
  const workspaceId = process.env.PLAN_GRAPH_DEMO_WORKSPACE_ID
  if (workspaceId) {
    redirect(`/workspace/${workspaceId}/d/${DEFAULT_DEMO_DAG_ID}`)
  }

  return <DagDemo />
}
