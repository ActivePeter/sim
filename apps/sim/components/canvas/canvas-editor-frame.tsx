import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'

interface CanvasEditorFrameProps {
  bottomPanel?: ReactNode
  children: ReactNode
  className?: string
  leadingPanel?: ReactNode
  overlay?: ReactNode
  sidePanel?: ReactNode
}

export function CanvasEditorFrame({
  bottomPanel,
  children,
  className,
  leadingPanel,
  overlay,
  sidePanel,
}: CanvasEditorFrameProps) {
  return (
    <div className={cn('flex h-full w-full overflow-hidden', className)}>
      {leadingPanel}
      <div className='flex min-w-0 flex-1 flex-col'>
        {children}
        {bottomPanel}
      </div>
      {sidePanel}
      {overlay}
    </div>
  )
}
