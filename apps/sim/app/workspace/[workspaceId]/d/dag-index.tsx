'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useI18n } from '@/lib/i18n'
import { useDags } from '@/hooks/queries/dags'

interface DagIndexProps {
  workspaceId: string
}

/** The landing entry is selected from the workspace's actual persisted DAGs. */
export function DagIndex({ workspaceId }: DagIndexProps) {
  const router = useRouter()
  const { t } = useI18n()
  const query = useDags(workspaceId)
  const firstDagId = query.isSuccess ? query.data.dags[0]?.id : undefined
  useEffect(() => {
    if (firstDagId)
      router.replace(
        `/workspace/${encodeURIComponent(workspaceId)}/d/${encodeURIComponent(firstDagId)}`
      )
  }, [firstDagId, router, workspaceId])
  return (
    <div
      role={query.isError ? 'alert' : 'status'}
      className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'
    >
      {query.error?.message ??
        (query.isPending || firstDagId ? t('plan.loading') : t('sidebar.noDags'))}
    </div>
  )
}
