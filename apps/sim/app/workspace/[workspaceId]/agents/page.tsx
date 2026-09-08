import { Suspense } from 'react'
import { AgentMonitor } from '@/app/workspace/[workspaceId]/agents/agent-monitor'
import AgentMonitorLoading from '@/app/workspace/[workspaceId]/agents/loading'

export default function AgentMonitorPage() {
  return (
    <Suspense fallback={<AgentMonitorLoading />}>
      <AgentMonitor />
    </Suspense>
  )
}
