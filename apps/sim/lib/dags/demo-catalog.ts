export interface DagCatalogItem {
  description: string
  id: string
  name: string
  repository: string
}

export const DEFAULT_DEMO_DAG_ID = 'agent-session-prs'

export const DEMO_DAGS: readonly DagCatalogItem[] = [
  {
    id: DEFAULT_DEMO_DAG_ID,
    name: 'Sim 自举开发路线',
    description: 'Sim 使用这张持久化 DAG 规划并交付自己的 Plan Graph 开发工作。',
    repository: 'ActivePeter/sim',
  },
]

export function getDemoDag(dagId: string): DagCatalogItem | undefined {
  return DEMO_DAGS.find((dag) => dag.id === dagId)
}
