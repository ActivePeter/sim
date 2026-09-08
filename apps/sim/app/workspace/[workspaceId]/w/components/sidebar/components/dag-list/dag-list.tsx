'use client'

import { cn } from '@sim/emcn'
import { Split } from '@sim/emcn/icons'
import { type DagCatalogItem, DEMO_DAGS } from '@/lib/dags/demo-catalog'
import { useI18n } from '@/lib/i18n'
import { useDagDocument } from '@/app/plan-graph-demo/hooks/use-dag-document'
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

interface DagListEntryProps extends DagListProps {
  dag: DagCatalogItem
}

export function DagList({ currentDagId, isCollapsed, workspaceId }: DagListProps) {
  const hover = useHoverMenu()
  const { t } = useI18n()
  const entries = DEMO_DAGS.map((dag) => (
    <DagListEntry
      key={dag.id}
      dag={dag}
      currentDagId={currentDagId}
      isCollapsed={isCollapsed}
      workspaceId={workspaceId}
    />
  ))

  if (isCollapsed) {
    return (
      <div className='px-2'>
        <CollapsedSidebarMenu
          icon={<Split className='size-[16px] flex-shrink-0 text-[var(--text-icon)]' />}
          hover={hover}
          ariaLabel={t('sidebar.dags')}
        >
          {entries}
        </CollapsedSidebarMenu>
      </div>
    )
  }

  return <div className={cn(SIDEBAR_ITEM_GAP_CLASS, 'flex flex-col px-2')}>{entries}</div>
}

function DagListEntry({ dag, currentDagId, isCollapsed, workspaceId }: DagListEntryProps) {
  const { t } = useI18n()
  const document = useDagDocument(workspaceId, dag.id)
  const name = document.dag?.name ?? (document.isMissing ? dag.name : t('plan.loading'))
  const href = `/workspace/${workspaceId}/d/${dag.id}`

  if (isCollapsed) {
    return (
      <CollapsedResourceFlyout
        entries={[{ kind: 'item', id: dag.id, name, pinned: false, href }]}
        icon={Split}
        currentItemId={currentDagId}
        emptyLabel={t('sidebar.noDags')}
      />
    )
  }

  return (
    <SidebarNavChip
      item={{ id: dag.id, label: name, icon: Split, href }}
      active={dag.id === currentDagId}
    />
  )
}
