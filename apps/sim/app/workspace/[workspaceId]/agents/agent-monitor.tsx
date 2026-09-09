'use client'

import { useMemo } from 'react'
import { Chip, ChipInput, ChipLink, ChipSelect, OverflowText } from '@sim/emcn'
import { Search } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { isSessionAccessDenied, visibleProjectSessions } from '@/lib/vibe-vscode/session-view'
import { ProjectLauncher } from '@/app/workspace/[workspaceId]/agents/components/project-launcher'
import {
  SESSION_STATUS_LABELS,
  SessionStatus,
} from '@/app/workspace/[workspaceId]/agents/components/session-status'
import {
  agentMonitorParsers,
  agentMonitorUrlKeys,
} from '@/app/workspace/[workspaceId]/agents/search-params'
import { useGlobalProjectSessions, useStopProjectSession } from '@/hooks/queries/vscode-agents'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

export function AgentMonitor() {
  const workspaces = useWorkspacesQuery()
  const workspaceIds = useMemo(
    () => (workspaces.data ?? []).map((workspace) => workspace.id),
    [workspaces.data]
  )
  const queries = useGlobalProjectSessions(workspaceIds)
  const stop = useStopProjectSession()
  const [filters, setFilters] = useQueryStates(agentMonitorParsers, agentMonitorUrlKeys)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )
  const names = useMemo(
    () => new Map(workspaces.data?.map((workspace) => [workspace.id, workspace.name])),
    [workspaces.data]
  )
  const sessions = isSessionAccessDenied(workspaces.error)
    ? []
    : queries.flatMap(visibleProjectSessions)
  const projects = [
    ...new Map(
      sessions
        .filter((session) => session.origin)
        .map((session) => [session.origin!.project.uri, session.origin!.project.name])
    ).entries(),
  ]
  const search = filters.search.trim().toLocaleLowerCase()
  const filtered = sessions
    .filter(
      (session) =>
        (filters.workspace === 'all' || session.workspaceId === filters.workspace) &&
        (filters.status === 'all' || session.status === filters.status) &&
        (filters.project === 'all' || session.origin?.project.uri === filters.project) &&
        (!search ||
          [
            session.title,
            session.id,
            session.origin?.project.name,
            session.origin?.logicalWorkspace?.name,
          ].some((value) => value?.toLocaleLowerCase().includes(search)))
    )
    .sort(
      (a, b) =>
        Number(b.status === 'running') - Number(a.status === 'running') ||
        b.updatedAt.localeCompare(a.updatedAt)
    )
  const error = workspaces.error ?? queries.find((query) => query.error)?.error ?? stop.error
  const pending = workspaces.isPending || queries.some((query) => query.isPending)
  const refresh = () => {
    void workspaces.refetch()
    for (const query of queries) void query.refetch()
  }

  return (
    <main className='flex h-full min-h-0 w-full flex-col overflow-y-auto bg-[var(--bg)] p-5'>
      <header className='mb-5 flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl'>全局 Agent 会话监控</h1>
          <p className='mt-1 text-[var(--text-muted)] text-small'>
            当前账号可访问的全部工作区 · 每个工作区最近 500 条 Sim 原生会话 · 每 4 秒刷新
          </p>
        </div>
        <Chip onClick={refresh}>刷新</Chip>
      </header>
      <div className='mb-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]'>
        <div className='rounded-lg border border-[var(--border)] p-4'>
          <ProjectLauncher />
        </div>
        <section aria-label='会话概况' className='flex flex-wrap content-start gap-3'>
          {(['running', 'complete', 'error', 'interrupted'] as const).map((status) => (
            <button
              key={status}
              type='button'
              onClick={() =>
                void setFilters({ status: filters.status === status ? 'all' : status })
              }
              className='flex min-w-[120px] flex-col gap-2 rounded-lg border border-[var(--border)] p-4 text-left transition-colors hover:bg-[var(--surface-active)]'
            >
              <SessionStatus status={status} />
              <span className='text-2xl'>
                {sessions.filter((session) => session.status === status).length}
              </span>
            </button>
          ))}
        </section>
      </div>
      <div className='mb-4 flex flex-wrap gap-2'>
        <ChipInput
          aria-label='搜索 Agent 会话'
          icon={Search}
          placeholder='搜索会话、项目、工作空间'
          value={filters.search}
          onChange={(event) => setSearch(event.target.value)}
          className='min-w-0 flex-1'
        />
        <ChipSelect
          aria-label='工作区筛选'
          value={filters.workspace}
          onChange={(workspace) => void setFilters({ workspace })}
          options={[
            { value: 'all', label: '全部工作区' },
            ...(workspaces.data ?? []).map((workspace) => ({
              value: workspace.id,
              label: workspace.name,
            })),
          ]}
        />
        <ChipSelect
          aria-label='项目筛选'
          value={filters.project}
          onChange={(project) => void setFilters({ project })}
          options={[
            { value: 'all', label: '全部项目' },
            ...projects.map(([value, label]) => ({ value, label })),
          ]}
        />
        <ChipSelect
          aria-label='状态筛选'
          value={filters.status}
          onChange={(status) => void setFilters({ status: status as typeof filters.status })}
          options={[
            { value: 'all', label: '全部状态' },
            ...Object.entries(SESSION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>
      {error && (
        <p role='alert' className='mb-3 text-[var(--text-error)] text-small'>
          部分会话暂时无法读取；不可验证的状态已标为未知，无权限的结果已隐藏：{error.message}
        </p>
      )}
      {pending && (
        <p role='status' className='p-4 text-[var(--text-muted)] text-small'>
          正在读取真实会话状态…
        </p>
      )}
      <div className='overflow-x-auto rounded-lg border border-[var(--border)]'>
        <table className='w-full text-left text-small'>
          <thead className='border-[var(--border)] border-b text-[var(--text-muted)]'>
            <tr>
              <th className='p-3 font-medium'>会话</th>
              <th className='p-3 font-medium'>项目 / 工作空间</th>
              <th className='p-3 font-medium'>状态</th>
              <th className='p-3 font-medium'>最近更新</th>
              <th className='p-3 font-medium'>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((session) => (
              <tr key={session.id} className='border-[var(--border)] border-b last:border-b-0'>
                <td className='max-w-[320px] p-3'>
                  <OverflowText label={session.title ?? '新会话'} />
                  <span className='text-[var(--text-muted)] text-caption'>{session.id}</span>
                </td>
                <td className='max-w-[300px] p-3'>
                  <OverflowText label={session.origin?.project.name ?? 'Sim 原生'} />
                  <OverflowText
                    className='text-[var(--text-muted)] text-caption'
                    label={
                      (names.get(session.workspaceId) ?? session.workspaceId) +
                      (session.origin?.logicalWorkspace
                        ? ` · ${session.origin.logicalWorkspace.name}`
                        : '')
                    }
                  />
                </td>
                <td className='p-3'>
                  <SessionStatus status={session.status} />
                </td>
                <td className='whitespace-nowrap p-3 text-[var(--text-muted)] text-caption'>
                  {new Date(session.updatedAt).toLocaleString()}
                </td>
                <td className='p-3'>
                  <div className='flex items-center gap-1'>
                    <ChipLink
                      href={`/workspace/${session.workspaceId}/chat/${session.id}`}
                      onClick={(event) => {
                        if (window.vibeVscode) {
                          event.preventDefault()
                          window.vibeVscode.openEditor(
                            `/workspace/${session.workspaceId}/chat/${session.id}`
                          )
                        }
                      }}
                    >
                      打开会话
                    </ChipLink>
                    {session.activeStreamId && (
                      <Chip
                        disabled={stop.isPending}
                        onClick={() =>
                          stop.mutate({
                            workspaceId: session.workspaceId,
                            chatId: session.id,
                            streamId: session.activeStreamId!,
                          })
                        }
                      >
                        停止
                      </Chip>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pending && filtered.length === 0 && (
          <p className='p-8 text-center text-[var(--text-muted)] text-small'>
            没有符合条件的会话。可以选择项目并创建第一个 Agent。
          </p>
        )}
      </div>
    </main>
  )
}
