'use client'

import { useState } from 'react'
import { Chip, ChipLink, OverflowText } from '@sim/emcn'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { visibleProjectSessions } from '@/lib/vibe-vscode/session-view'
import { withVibeVscodeSurface } from '@/lib/vibe-vscode/surface'
import { ProjectLauncher } from '@/app/workspace/[workspaceId]/agents/components/project-launcher'
import { SessionStatus } from '@/app/workspace/[workspaceId]/agents/components/session-status'
import { useProjectSessions } from '@/hooks/queries/vscode-agents'

interface AgentSidebarProps {
  children: React.ReactNode
}

export function AgentSidebar({ children }: AgentSidebarProps) {
  const { workspaceId, chatId } = useParams<{ workspaceId: string; chatId?: string }>()
  const pathname = usePathname()
  const sessions = useProjectSessions(workspaceId)
  const visible = visibleProjectSessions(sessions)
  const [expanded, setExpanded] = useState(false)
  const current = visible.find((session) => session.id === chatId)
  const showChat = !!chatId && pathname.includes('/chat/')
  const editorPath = showChat
    ? `/workspace/${workspaceId}/chat/${chatId}`
    : `/workspace/${workspaceId}/agents`
  return (
    <aside
      data-vscode-agent-sidebar
      className='flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--bg)]'
    >
      <div className='flex shrink-0 flex-col gap-3 border-[var(--border)] border-b p-3'>
        <ProjectLauncher compact />
        <div className='flex flex-wrap items-center gap-1'>
          <Chip onClick={() => setExpanded((value) => !value)} active={expanded}>
            会话 {visible.length || ''}
          </Chip>
          <Chip onClick={() => window.vibeVscode?.openMonitor()}>全局监控</Chip>
          <ChipLink
            href={editorPath}
            onClick={(event) => {
              if (window.vibeVscode) {
                event.preventDefault()
                window.vibeVscode.openEditor(editorPath)
              }
            }}
          >
            在 Sim 中打开
          </ChipLink>
        </div>
        {current?.origin && (
          <div className='flex min-w-0 items-center gap-2 text-caption'>
            <OverflowText
              className='flex-1'
              label={`${current.origin.project.name} · ${current.runtime}`}
            />
            <SessionStatus status={current.status} />
          </div>
        )}
      </div>
      {(expanded || !showChat) && (
        <nav
          aria-label='Sim Agent 会话'
          className={
            'overflow-y-auto border-[var(--border)] border-b p-2 ' +
            (showChat ? 'max-h-[180px] shrink-0' : 'min-h-0 flex-1')
          }
        >
          {sessions.isPending && (
            <p role='status' className='p-2 text-[var(--text-muted)] text-caption'>
              正在读取会话…
            </p>
          )}
          {sessions.error && (
            <p role='alert' className='p-2 text-[var(--text-error)] text-caption'>
              {sessions.error.message}
            </p>
          )}
          {visible.map((session) => (
            <Link
              key={session.id}
              href={withVibeVscodeSurface(
                `/workspace/${session.workspaceId}/chat/${session.id}`,
                'sidebar'
              )}
              aria-current={chatId === session.id ? 'page' : undefined}
              className='flex min-w-0 flex-col gap-1 rounded-lg p-2 transition-colors hover:bg-[var(--surface-active)] aria-[current=page]:bg-[var(--surface-active)]'
            >
              <OverflowText className='text-small' label={session.title ?? '新会话'} />
              <div className='flex min-w-0 items-center justify-between gap-2'>
                <OverflowText
                  className='text-[var(--text-muted)] text-caption'
                  label={session.origin?.project.name ?? 'Sim'}
                />
                <SessionStatus status={session.status} />
              </div>
            </Link>
          ))}
          {!sessions.isPending && !sessions.error && visible.length === 0 && (
            <p className='p-3 text-[var(--text-muted)] text-small'>
              选择项目并新建会话，即可在这里直接对话。
            </p>
          )}
        </nav>
      )}
      {showChat && <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>{children}</div>}
    </aside>
  )
}
