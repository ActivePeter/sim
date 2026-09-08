import type { Metadata } from 'next'
import { DagEditor } from '@/app/workspace/[workspaceId]/d/[dagId]/dag'

export const metadata: Metadata = {
  title: 'PR 依赖 DAG | Sim',
}

interface DagPageProps {
  params: Promise<{ dagId: string; workspaceId: string }>
}

export default async function DagPage({ params }: DagPageProps) {
  const { dagId, workspaceId } = await params

  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden'>
      <DagEditor
        key={JSON.stringify([workspaceId, dagId])}
        dagId={dagId}
        workspaceId={workspaceId}
      />
    </main>
  )
}
