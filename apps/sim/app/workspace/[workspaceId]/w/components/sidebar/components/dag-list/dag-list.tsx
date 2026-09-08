'use client'

import { cn } from '@sim/emcn'
import { Split } from '@sim/emcn/icons'
import { useI18n } from '@/lib/i18n'
import {
  CollapsedResourceFlyout,
  CollapsedSidebarMenu,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu'
import { SidebarNavChip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-nav-chip'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useDags } from '@/hooks/queries/dags'

interface DagListProps {
  currentDagId?: string
  isCollapsed: boolean
  workspaceId: string
}

export function DagList({ currentDagId, isCollapsed, workspaceId }: DagListProps) {
  const hover = useHoverMenu()
  const { t } = useI18n()
  const query = useDags(workspaceId)
  const entries = (query.isError ? [] : (query.data?.dags ?? [])).map((dag) => ({
    kind: 'item' as const,
    id: dag.id,
    name: dag.name,
    pinned: false,
    href: `/workspace/${encodeURIComponent(workspaceId)}/d/${encodeURIComponent(dag.id)}`,
  }))
  const emptyLabel =
    query.error?.message ?? (query.isPending ? t('plan.loading') : t('sidebar.noDags'))

  if (isCollapsed) {
    return (
      <div className='px-2'>
        <CollapsedSidebarMenu
          icon={<Split className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />}
          hover={hover}
          ariaLabel={t('sidebar.dags')}
        >
          <CollapsedResourceFlyout
            entries={entries}
            icon={Split}
            currentItemId={currentDagId}
            emptyLabel={emptyLabel}
          />
        </CollapsedSidebarMenu>
      </div>
    )
  }
  return (
    <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
      {entries.map((entry) => (
        <SidebarNavChip
          key={entry.id}
          item={{ id: entry.id, label: entry.name, icon: Split, href: entry.href }}
          active={entry.id === currentDagId}
        />
      ))}
      {entries.length === 0 && (
        <p
          role={query.isError ? 'alert' : 'status'}
          className='px-2 py-1 text-[var(--text-muted)] text-xs'
        >
          {emptyLabel}
        </p>
      )}
    </div>
  )
}
