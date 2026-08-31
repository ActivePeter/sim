'use client'

import { cn } from '@sim/emcn'
import { Split } from '@sim/emcn/icons'
import { DEMO_DAGS } from '@/lib/dags/demo-catalog'
import {
  CollapsedResourceFlyout,
  CollapsedSidebarMenu,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu'
import { SidebarNavChip } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-nav-chip'
import { SIDEBAR_ITEM_GAP_CLASS } from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'

interface DagListProps {
  currentDagId?: string
  isCollapsed: boolean
  workspaceId: string
}

export function DagList({ currentDagId, isCollapsed, workspaceId }: DagListProps) {
  const hover = useHoverMenu()
  const flyoutEntries = DEMO_DAGS.map((dag) => ({
    kind: 'item' as const,
    id: dag.id,
    name: dag.name,
    pinned: false,
    href: `/workspace/${workspaceId}/d/${dag.id}`,
  }))

  if (isCollapsed) {
    return (
      <div className='px-2'>
        <CollapsedSidebarMenu
          icon={<Split className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />}
          hover={hover}
          ariaLabel='DAGs'
        >
          <CollapsedResourceFlyout
            entries={flyoutEntries}
            icon={Split}
            currentItemId={currentDagId}
            emptyLabel='No DAGs yet'
          />
        </CollapsedSidebarMenu>
      </div>
    )
  }

  return (
    <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>
      {DEMO_DAGS.map((dag) => (
        <SidebarNavChip
          key={dag.id}
          item={{
            id: dag.id,
            label: dag.name,
            icon: Split,
            href: `/workspace/${workspaceId}/d/${dag.id}`,
          }}
          active={dag.id === currentDagId}
        />
      ))}
    </div>
  )
}
