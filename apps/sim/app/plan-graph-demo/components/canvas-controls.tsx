import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { CanvasActionBar, type CanvasInteractionMode } from '@/components/canvas'

interface CanvasControlsProps {
  mode: CanvasInteractionMode
  onModeChange: (mode: CanvasInteractionMode) => void
}

export function CanvasControls({ mode, onModeChange }: CanvasControlsProps) {
  const reactFlow = useReactFlow()

  const handleFitView = useCallback(() => {
    void reactFlow.fitView({ padding: 0.18, duration: 250, maxZoom: 1 })
  }, [reactFlow])

  return <CanvasActionBar mode={mode} onModeChange={onModeChange} onFitView={handleFitView} />
}
