import { Suspense } from 'react'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { internalSessionAuth } from '@/lib/api/server/routes'
import { getSession } from '@/lib/auth'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveProjectChatRuntime } from '@/lib/vibe-vscode/application/projects'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { Home } from '@/app/workspace/[workspaceId]/home/home'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { prefetchHomeSurface } from '@/app/workspace/[workspaceId]/home/prefetch'

export const metadata: Metadata = {
  title: 'Chat',
}

interface ChatPageProps {
  params: Promise<{
    workspaceId: string
    chatId: string
  }>
}

export default async function ChatPage({ params }: ChatPageProps) {
  // The layout 404s too, but pages and layouts resolve concurrently — without this
  // the prefetch below still fires on its way out.
  if (!isChatEnabled) {
    notFound()
  }

  const [{ workspaceId, chatId }, session] = await Promise.all([params, getSession()])
  const userId = session?.user?.id
  const projectRuntime = await (async () => {
    if (!userId) return undefined
    try {
      return await resolveProjectChatRuntime.execute({
        principal: await internalSessionAuth.authenticate(),
        input: { workspaceId, chatId },
      })
    } catch (error) {
      if (error instanceof OrchestrationError && ['forbidden', 'not_found'].includes(error.code))
        notFound()
      throw error
    }
  })()
  const queryClient = getQueryClient()
  await prefetchHomeSurface(queryClient, workspaceId, userId)
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<HomeFallback />}>
        <Home
          key={chatId}
          chatId={chatId}
          userName={session?.user?.name}
          userId={userId}
          projectOrigin={projectRuntime?.origin}
        />
      </Suspense>
    </HydrationBoundary>
  )
}
