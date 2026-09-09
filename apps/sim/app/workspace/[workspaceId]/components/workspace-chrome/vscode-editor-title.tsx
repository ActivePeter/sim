'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useDag } from '@/hooks/queries/dags'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useWorkflowMap } from '@/hooks/queries/workflows'

/** Projects native resource names into host tabs using the same queries as Sim's own UI. */
export function VscodeEditorTitle() {
  const { workspaceId, workflowId, dagId, chatId } = useParams<{
    workspaceId: string
    workflowId?: string
    dagId?: string
    chatId?: string
  }>()
  const workflows = useWorkflowMap(workflowId ? workspaceId : undefined)
  const dags = useDag(dagId ? workspaceId : '', dagId ?? '')
  const chats = useMothershipChats(chatId ? workspaceId : undefined)
  const kind = workflowId ? 'w' : dagId ? 'd' : chatId ? 'chat' : undefined
  const resourceId = workflowId ?? dagId ?? chatId
  const path =
    kind && resourceId
      ? `/workspace/${encodeURIComponent(workspaceId)}/${kind}/${encodeURIComponent(resourceId)}`
      : undefined
  const title = workflowId
    ? workflows.isPlaceholderData
      ? undefined
      : workflows.data?.[workflowId]?.name
    : dagId
      ? dags.data?.dag.name
      : chatId && !chats.isPlaceholderData
        ? chats.data?.find((chat) => chat.id === chatId)?.name
        : undefined

  useEffect(() => {
    if (!path || !title) return
    let reportedBridge: Window['vibeVscode']
    const publish = () => {
      const bridge = window.vibeVscode
      if (bridge && bridge !== reportedBridge) {
        bridge.setEditorTitle(path, title)
        reportedBridge = bridge
      }
    }
    publish()
    window.addEventListener('vibe-vscode-context', publish)
    return () => window.removeEventListener('vibe-vscode-context', publish)
  }, [path, title])

  return null
}
