import { DagIndex } from '@/app/workspace/[workspaceId]/d/dag-index'

interface DagIndexPageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function DagIndexPage({ params }: DagIndexPageProps) {
  const { workspaceId } = await params
  return <DagIndex workspaceId={workspaceId} />
}
