import { cn } from '@sim/emcn'
import type { ProjectSession } from '@/lib/api/contracts/vscode-agents'

export const SESSION_STATUS_LABELS: Record<ProjectSession['status'], string> = {
  idle: '未开始',
  running: '运行中',
  complete: '已完成',
  cancelled: '已停止',
  error: '失败',
  interrupted: '运行已中断',
  unknown: '状态待确认',
}

interface SessionStatusProps {
  status: ProjectSession['status']
}

export function SessionStatus({ status }: SessionStatusProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-caption',
        status === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
      )}
    >
      <span
        className={cn(
          'size-[6px] rounded-full bg-current',
          status === 'running' && 'animate-pulse'
        )}
        aria-hidden
      />
      {SESSION_STATUS_LABELS[status]}
    </span>
  )
}
