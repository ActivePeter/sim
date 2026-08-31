import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDemoDag } from '@/lib/dags/demo-catalog'
import { DagDemo } from '@/app/plan-graph-demo/plan-graph-demo'

export const metadata: Metadata = {
  title: 'PR Dependency DAG',
}

interface DagPageProps {
  params: Promise<{ dagId: string; workspaceId: string }>
}

export default async function DagPage({ params }: DagPageProps) {
  const { dagId, workspaceId } = await params
  if (!getDemoDag(dagId)) notFound()

  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden'>
      <DagDemo dagId={dagId} workspaceId={workspaceId} />
    </main>
  )
}
