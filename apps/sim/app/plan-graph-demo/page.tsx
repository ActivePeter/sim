import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DEFAULT_DEMO_DAG_ID } from '@/lib/dags/demo-catalog'
import { DagDemo } from '@/app/plan-graph-demo/plan-graph-demo'

export const metadata: Metadata = {
  title: 'Agent DAG 演示 | Sim',
  description: '供人编排 PR 依赖关系、由多个编码 Agent 并行执行的 DAG 画布。',
}

export default function DagDemoPage() {
  const workspaceId = process.env.PLAN_GRAPH_DEMO_WORKSPACE_ID
  if (workspaceId) {
    redirect(`/workspace/${workspaceId}/d/${DEFAULT_DEMO_DAG_ID}`)
  }

  return <DagDemo />
}
