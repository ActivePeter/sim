import type { Metadata } from 'next'
import { RoadmapDemo } from '@/app/plan-graph-demo/plan-graph-demo'

export const metadata: Metadata = {
  title: 'Agent Roadmap Demo | Sim',
  description:
    'A roadmap canvas for human-authored PR dependencies executed by multiple coding agents.',
}

export default function RoadmapDemoPage() {
  return <RoadmapDemo />
}
