import { useCallback } from 'react'
import { Button, Tooltip } from '@sim/emcn'
import { SelectAll, ZoomIn, ZoomOut } from '@sim/emcn/icons'
import { useReactFlow } from 'reactflow'

const CONTROL_CLASS =
  'size-[28px] rounded-sm p-0 text-[var(--text-icon)] hover-hover:text-[var(--text-primary)]'

export function CanvasControls() {
  const reactFlow = useReactFlow()

  const handleFitView = useCallback(() => {
    void reactFlow.fitView({ padding: 0.18, duration: 250, maxZoom: 1 })
  }, [reactFlow])

  const handleZoomIn = useCallback(() => {
    void reactFlow.zoomIn({ duration: 150 })
  }, [reactFlow])

  const handleZoomOut = useCallback(() => {
    void reactFlow.zoomOut({ duration: 150 })
  }, [reactFlow])

  return (
    <div className='absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1 shadow-sm'>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button variant='ghost' className={CONTROL_CLASS} onClick={handleZoomOut}>
            <ZoomOut className='size-[14px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>Zoom out</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button variant='ghost' className={CONTROL_CLASS} onClick={handleZoomIn}>
            <ZoomIn className='size-[14px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>Zoom in</Tooltip.Content>
      </Tooltip.Root>

      <div className='mx-1 h-[18px] w-px bg-[var(--border)]' />

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button variant='ghost' className={CONTROL_CLASS} onClick={handleFitView}>
            <SelectAll className='size-[14px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>Fit plan to view</Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}
