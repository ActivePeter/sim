'use client'

import { type MouseEventHandler, memo, useState } from 'react'
import {
  Button,
  ChevronDown,
  Cursor,
  chipHoverSurfaceClass,
  cn,
  disclosureChevronClass,
  Hand,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Redo,
  Tooltip,
  Undo,
} from '@sim/emcn'
import { SelectAll } from '@sim/emcn/icons'

export type CanvasInteractionMode = 'cursor' | 'hand'

interface CanvasActionBarProps {
  canRedo?: boolean
  canUndo?: boolean
  mode: CanvasInteractionMode
  onContextMenu?: MouseEventHandler<HTMLDivElement>
  onFitView: () => void
  onModeChange: (mode: CanvasInteractionMode) => void
  onRedo?: () => void
  onUndo?: () => void
}

export const CanvasActionBar = memo(function CanvasActionBar({
  canRedo = false,
  canUndo = false,
  mode,
  onContextMenu,
  onFitView,
  onModeChange,
  onRedo,
  onUndo,
}: CanvasActionBarProps) {
  const [isCanvasModeOpen, setIsCanvasModeOpen] = useState(false)
  const showHistory = Boolean(onUndo && onRedo)

  return (
    <div
      className='absolute bottom-3 left-3 z-10 flex h-[36px] items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1'
      onContextMenu={onContextMenu}
    >
      <Popover open={isCanvasModeOpen} onOpenChange={setIsCanvasModeOpen} size='sm'>
        <Tooltip.Root>
          <PopoverTrigger asChild>
            <div className='flex cursor-pointer items-center gap-1'>
              <Tooltip.Trigger asChild>
                <Button
                  aria-label={mode === 'hand' ? 'Mover mode' : 'Pointer mode'}
                  className='size-[28px] rounded-sm p-0'
                  variant='active'
                >
                  {mode === 'hand' ? (
                    <Hand className='size-[14px]' />
                  ) : (
                    <Cursor className='size-[14px]' />
                  )}
                </Button>
              </Tooltip.Trigger>
              <Button
                aria-label='Choose canvas mode'
                variant='ghost'
                className={cn('size-[20px] rounded-sm p-0', chipHoverSurfaceClass)}
              >
                <ChevronDown
                  className={cn(disclosureChevronClass, isCanvasModeOpen && 'rotate-180')}
                />
              </Button>
            </div>
          </PopoverTrigger>
          <Tooltip.Content side='top'>{mode === 'hand' ? 'Mover' : 'Pointer'}</Tooltip.Content>
        </Tooltip.Root>
        <PopoverContent side='top' sideOffset={8} maxWidth={100} minWidth={100}>
          <PopoverItem
            onClick={() => {
              onModeChange('hand')
              setIsCanvasModeOpen(false)
            }}
          >
            <Hand className='size-[14px]' />
            <span>Mover</span>
          </PopoverItem>
          <PopoverItem
            onClick={() => {
              onModeChange('cursor')
              setIsCanvasModeOpen(false)
            }}
          >
            <Cursor className='size-[14px]' />
            <span>Pointer</span>
          </PopoverItem>
        </PopoverContent>
      </Popover>

      {showHistory && (
        <>
          <div className='mx-1 h-[20px] w-px bg-[var(--border)]' />

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                aria-label='Undo'
                variant='ghost'
                className={cn('size-[28px] rounded-sm p-0', chipHoverSurfaceClass)}
                onClick={onUndo}
                disabled={!canUndo}
              >
                <Undo className='size-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              <Tooltip.Shortcut keys='⌘Z'>Undo</Tooltip.Shortcut>
            </Tooltip.Content>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                aria-label='Redo'
                variant='ghost'
                className={cn('size-[28px] rounded-sm p-0', chipHoverSurfaceClass)}
                onClick={onRedo}
                disabled={!canRedo}
              >
                <Redo className='size-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side='top'>
              <Tooltip.Shortcut keys='⌘⇧Z'>Redo</Tooltip.Shortcut>
            </Tooltip.Content>
          </Tooltip.Root>
        </>
      )}

      <div className='mx-1 h-[20px] w-px bg-[var(--border)]' />

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            aria-label='Fit to view'
            variant='ghost'
            className={cn('size-[28px] rounded-sm p-0', chipHoverSurfaceClass)}
            onClick={onFitView}
          >
            <SelectAll className='size-[14px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='top'>
          <Tooltip.Shortcut keys='⌘⇧F'>Fit to View</Tooltip.Shortcut>
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
})
