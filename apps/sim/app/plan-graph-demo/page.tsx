import type { Metadata } from 'next'
import { PlanGraphDemo } from '@/app/plan-graph-demo/plan-graph-demo'

export const metadata: Metadata = {
  title: 'Plan Graph Demo | Sim',
  description:
    'Interactive demo of a human-authored PR dependency graph executed by multiple coding agents.',
}

export default function PlanGraphDemoPage() {
  return <PlanGraphDemo />
}
