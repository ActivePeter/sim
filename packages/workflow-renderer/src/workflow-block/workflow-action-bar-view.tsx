import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

/** Canonical button chrome shared by workflow-shaped node action rows. */
export const WORKFLOW_ACTION_BUTTON_CLASSNAME = [
  'size-[24px] rounded-md p-0',
  'border-none bg-transparent text-[var(--text-icon)]',
  'hover-hover:bg-[var(--surface-5)] hover-hover:!text-[var(--text-primary)]',
  'dark:hover-hover:bg-[var(--surface-4)]',
  'transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.96]',
].join(' ')

/** Selection-aware button treatment inside the workflow border swell. */
export const WORKFLOW_SWELL_ACTION_BUTTON_CLASSNAME = [
  'group-data-[node-selected]:text-[var(--surface-2)]',
  'hover-hover:group-data-[node-selected]:bg-[var(--surface-2)]',
  'hover-hover:group-data-[node-selected]:!text-[var(--text-primary)]',
].join(' ')

/** Leading taper shared by the first button in a workflow border swell. */
export const WORKFLOW_FIRST_SWELL_ACTION_BUTTON_CLASSNAME =
  "!w-[40px] [clip-path:path('M23.75_0A8_8_0_0_0_17.6_2.88L3.41_19.9A2.5_2.5_0_0_0_5.34_24L36_24A4_4_0_0_0_40_20L40_4A4_4_0_0_0_36_0Z')] [&>svg]:translate-y-px"

/** Trailing taper shared by the final button in a workflow border swell. */
export const WORKFLOW_LAST_SWELL_ACTION_BUTTON_CLASSNAME =
  "!w-[40px] [clip-path:path('M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z')] [&_svg]:-translate-x-[6px] [&_svg]:translate-y-px"

export interface WorkflowActionBarViewProps {
  children: ReactNode
  variant?: 'floating' | 'swell'
}

/**
 * Shared layout and reveal behavior for action rows attached to workflow-shaped nodes.
 *
 * The editor supplies workflow mutations while other graph documents can supply their own
 * domain actions without recreating the block swell, spacing, or selection treatment.
 */
export function WorkflowActionBarView({
  children,
  variant = 'floating',
}: WorkflowActionBarViewProps) {
  const isSwell = variant === 'swell'

  return (
    <div
      data-workflow-action-bar-swell={isSwell ? '' : undefined}
      className={cn(
        'absolute rounded-lg',
        isSwell
          ? [
              '-top-[28px] right-[24px] z-[40] h-[28px] w-fit overflow-hidden px-[0.2rem] py-0.5',
              'pointer-events-auto',
            ]
          : [
              '-top-[40px] pointer-events-auto right-0 flex flex-row items-center gap-[2px] p-[3px]',
              'border-[1.5px] border-[var(--border-1)] bg-[var(--surface-2)]',
              'opacity-0 transition-opacity duration-[150ms] group-hover:opacity-100',
            ]
      )}
    >
      <div
        className={cn(
          'relative flex flex-row items-center gap-[2px]',
          isSwell && [
            'pointer-events-none h-full opacity-0 transition-opacity duration-[30ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
            'group-data-[action-menu-ready]:pointer-events-auto group-data-[action-menu-ready]:opacity-100 group-data-[action-menu-ready]:duration-100',
          ]
        )}
      >
        {children}
      </div>
    </div>
  )
}
