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
    name: 'Agent session PR rollout',
    description: 'Planned and active pull requests for the Agent Session delivery DAG.',
    repository: 'ActivePeter/sim',
  },
]

export function getDemoDag(dagId: string): DagCatalogItem | undefined {
  return DEMO_DAGS.find((dag) => dag.id === dagId)
}
