'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip, ChipSelect, OverflowText, Popover, PopoverContent, PopoverTrigger } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { generateId } from '@sim/utils/id'
import { useParams, useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { withVibeVscodeSurface } from '@/lib/vibe-vscode/surface'
import { projectSelectionParam } from '@/app/workspace/[workspaceId]/agents/search-params'
import { useCreateProjectSession, useVscodeHosts } from '@/hooks/queries/vscode-agents'
import { useVscodeCatalogProjection } from '@/hooks/use-vscode-catalog-projection'
import { useVscodeHostContext } from '@/hooks/use-vscode-host-context'
import { useVscodeSurface } from '@/hooks/use-vscode-surface'

interface ProjectLauncherProps {
  compact?: boolean
  triggerLabel?: string
}

export function ProjectLauncher({
  compact = false,
  triggerLabel = '新建项目 Agent',
}: ProjectLauncherProps) {
  const [open, setOpen] = useState(false)
  const [sidebarSelection, setSidebarSelection] = useState<string | null>(null)
  const requests = useRef(new Map<string, string>())
  const creating = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const router = useRouter()
  const surface = useVscodeSurface()
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [querySelection, setQuerySelection] = useQueryState(
    projectSelectionParam.key,
    projectSelectionParam.parser
  )
  const selection = compact ? sidebarSelection : querySelection
  const hostsQuery = useVscodeHosts(workspaceId)
  const { mutateAsync, isPending, error } = useCreateProjectSession()
  const context = useVscodeHostContext()
  const projection = useVscodeCatalogProjection({
    workspaceId,
    context,
    hosts: hostsQuery.data?.hosts,
  })
  const projects = useMemo(
    () =>
      (hostsQuery.data?.hosts ?? [])
        .filter((host) => !compact || host.id === projection.host?.id)
        .flatMap((host) =>
          host.catalog.physicalWorkspace.folders.map((project) => ({
            key: `${host.id}:${project.uri}`,
            host,
            project,
          }))
        ),
    [hostsQuery.data, compact, projection.host?.id]
  )
  const active =
    projects.find((item) => item.key === selection) ??
    projects.find(
      (item) => item.host.id === projection.host?.id && item.project.uri === context?.project?.uri
    ) ??
    projects[0]
  const displayError = error ?? hostsQuery.error ?? projection.error
  const awaitingHost = compact && !context?.physicalWorkspace
  const logicalWorkspaceId =
    active?.host.id === projection.host?.id ? context?.logicalWorkspace?.id : undefined
  const identity = JSON.stringify([
    workspaceId,
    active?.host.id,
    active?.project.uri,
    logicalWorkspaceId,
  ])
  const latestIdentity = useRef(identity)
  latestIdentity.current = identity
  const create = useCallback(async () => {
    if (!active || creating.current || projection.isSyncing || awaitingHost) return
    // Capture all identity before awaiting creation; a subsequent project switch cannot retarget it.
    const requestId = requests.current.get(identity) ?? generateId()
    requests.current.set(identity, requestId)
    creating.current = true
    try {
      const result = await mutateAsync({
        workspaceId,
        hostId: active.host.id,
        projectUri: active.project.uri,
        logicalWorkspaceId,
        requestId,
      })
      requests.current.delete(identity)
      if (mounted.current && latestIdentity.current === identity) {
        const path = `/workspace/${result.workspaceId}/chat/${result.id}`
        setOpen(false)
        if (window.vibeVscode) {
          window.vibeVscode.openEditor(path)
        } else {
          router.push(withVibeVscodeSurface(path, surface))
        }
      }
    } catch {
      // Keep the request ID after an unknown outcome: retry opens the same native chat.
    } finally {
      creating.current = false
    }
  }, [
    active,
    projection.isSyncing,
    identity,
    logicalWorkspaceId,
    awaitingHost,
    workspaceId,
    mutateAsync,
    router,
    surface,
  ])

  const launcher = (
    <section aria-label='项目 Agent' className='flex min-w-0 flex-col gap-2'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-[var(--text-muted)] text-caption'>项目 Agent · Sim</span>
        {(projection.isSyncing || awaitingHost) && (
          <span role='status' className='text-[var(--text-muted)] text-caption'>
            {awaitingHost ? '读取 VS Code 项目…' : '同步项目…'}
          </span>
        )}
      </div>
      <ChipSelect
        aria-label='选择 Agent 项目'
        fullWidth
        dropdownWidth='trigger'
        value={active?.key ?? ''}
        onChange={(value) => {
          if (compact) setSidebarSelection(value)
          else void setQuerySelection(value)
        }}
        placeholder={hostsQuery.isPending ? '正在读取项目…' : '尚无 VS Code 项目'}
        options={projects.map((item) => ({
          value: item.key,
          label:
            item.project.name + (compact ? '' : ` · ${item.host.catalog.physicalWorkspace.name}`),
          tooltip: item.project.uri,
        }))}
      />
      {active && (
        <OverflowText
          className='text-[var(--text-muted)] text-caption'
          label={active.project.uri}
        />
      )}
      {context?.logicalWorkspace && (
        <span className='text-[var(--text-muted)] text-caption'>
          工作空间：{context.logicalWorkspace.name}
        </span>
      )}
      <Chip
        variant='primary'
        leftIcon={Plus}
        disabled={!active || isPending || projection.isSyncing || awaitingHost}
        onClick={() => void create()}
      >
        {isPending ? '正在创建…' : '新建项目 Agent 会话'}
      </Chip>
      {displayError && (
        <div className='flex flex-col gap-1'>
          <p role='alert' className='break-words text-[var(--text-error)] text-caption'>
            {displayError.message}
          </p>
          <Chip
            onClick={() => {
              void hostsQuery.refetch()
              projection.retry()
            }}
          >
            重试同步
          </Chip>
        </div>
      )}
      {!hostsQuery.isPending && !projects.length && !displayError && (
        <p className='text-[var(--text-muted)] text-caption'>
          在 VS Code 中打开项目，Sim 会自动同步项目列表。
        </p>
      )}
    </section>
  )

  if (!compact) return launcher

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Chip leftIcon={Plus} fullWidth active={open}>
          {triggerLabel}
        </Chip>
      </PopoverTrigger>
      <PopoverContent align='start' side='bottom' className='w-[280px] max-w-[calc(100vw-16px)]'>
        <div className='p-2'>{launcher}</div>
      </PopoverContent>
    </Popover>
  )
}
