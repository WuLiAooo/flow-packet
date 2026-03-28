import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useCanvasStore, type BeginNodeData } from '@/stores/canvasStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStatusStore } from '@/stores/sessionStatusStore'

const stateLabelMap: Record<string, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  logging_in: 'Logging in',
  ready: 'Ready',
  disconnected: 'Disconnected',
  error: 'Error',
}

const stateToneMap: Record<string, string> = {
  connecting: 'text-amber-600',
  connected: 'text-sky-600',
  logging_in: 'text-amber-600',
  ready: 'text-emerald-600',
  disconnected: 'text-muted-foreground',
  error: 'text-red-600',
}

export function DeviceSessionStatusPanel() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const beginNode = useCanvasStore((s) => s.nodes.find((node) => node.type === 'beginNode'))

  if (!activeConnectionId || !beginNode) return null

  const beginData = beginNode.data as BeginNodeData
  const deviceId = (beginData.deviceId || '').trim()
  const statusKey = deviceId ? `${activeConnectionId}::${deviceId}` : null
  const status = useSessionStatusStore((s) => (statusKey ? s.statuses[statusKey] : undefined))
  const state = status?.state ?? (deviceId ? 'not_created' : 'not_configured')
  const stateLabel = state === 'not_configured'
    ? 'Not configured'
    : state === 'not_created'
      ? 'Not created'
      : (stateLabelMap[state] ?? state)
  const stateTone = state === 'not_configured' || state === 'not_created'
    ? 'text-muted-foreground'
    : (stateToneMap[state] ?? 'text-muted-foreground')

  return (
    <Card className="pointer-events-none absolute right-3 top-3 z-20 w-[260px] border-border/70 bg-background/88 p-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Begin Session
          </div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">
            {deviceId || 'No deviceId'}
          </div>
        </div>
        <Badge variant="outline" className={stateTone}>
          {stateLabel}
        </Badge>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        {deviceId
          ? 'This panel tracks the business session bound to the current BeginNode deviceId.'
          : 'Double-click BeginNode and set deviceId to enable business-session execution.'}
      </div>
      {status?.error && (
        <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/8 px-2 py-1.5 text-xs text-red-600">
          {status.error}
        </div>
      )}
    </Card>
  )
}
