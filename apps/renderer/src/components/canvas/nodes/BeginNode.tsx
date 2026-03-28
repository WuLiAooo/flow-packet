import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStatusStore } from '@/stores/sessionStatusStore'
import type { BeginNodeData } from '@/stores/canvasStore'

const sessionStateLabelMap: Record<string, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  logging_in: 'Logging in',
  ready: 'Ready',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting',
  error: 'Error',
  not_configured: 'No deviceId',
  need_login: 'Need Login',
}

const sessionStateBadgeClassMap: Record<string, string> = {
  connecting: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  connected: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
  logging_in: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  disconnected: 'border-red-500/30 bg-red-500/10 text-red-700',
  reconnecting: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  error: 'border-red-500/30 bg-red-500/10 text-red-700',
  not_configured: 'border-border/70 bg-muted/40 text-muted-foreground',
  need_login: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
}

const connectionIconToneMap: Record<string, string> = {
  connected: 'bg-emerald-500/20 text-emerald-600',
  connecting: 'bg-amber-500/20 text-amber-600',
  reconnecting: 'bg-amber-500/20 text-amber-600',
  disconnected: 'bg-red-500/20 text-red-600',
}

export function BeginNode({ data, selected }: NodeProps<Node<BeginNodeData>>) {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const connectionState = useConnectionStore((s) => s.state)
  const deviceId = (data.deviceId || '').trim()
  const sessionStatus = useSessionStatusStore((s) => (
    activeConnectionId && deviceId
      ? s.statuses[`${activeConnectionId}::${deviceId}`]
      : undefined
  ))

  const stateKey = !deviceId
    ? 'not_configured'
    : sessionStatus?.state
      ? sessionStatus.state
      : connectionState === 'connected'
        ? 'need_login'
        : connectionState
  const stateLabel = sessionStateLabelMap[stateKey] ?? stateKey
  const badgeClassName = sessionStateBadgeClassMap[stateKey] ?? sessionStateBadgeClassMap['not_configured']
  const iconToneClassName = connectionIconToneMap[connectionState] ?? connectionIconToneMap['disconnected']
  const isReady = stateKey === 'ready'

  return (
    <Card
      className={cn(
        'relative overflow-hidden rounded-[14px] border p-0 transition-all duration-200',
        selected && 'border-primary ring-1 ring-primary',
      )}
      style={{
        minWidth: 208,
        borderWidth: 1,
        background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.14))',
      }}
    >
      <div className="absolute right-3 top-3">
        <div className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', badgeClassName)}>
          {stateLabel}
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-3 pr-24">
        <div className="relative flex size-10 items-center justify-center">
          {isReady && <div className="begin-node-ready-halo" />}
          {isReady && <div className="begin-node-ready-ring" />}
          <div className={cn('relative z-[1] flex size-8 items-center justify-center rounded-full transition-colors', iconToneClassName)}>
            <Play className="size-4 fill-current" />
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Entry</div>
          <div className="truncate text-sm font-semibold text-foreground">{data.label}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {deviceId || 'Double-click to set deviceId'}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="exec-out"
        style={{
          top: '50%',
          right: -8,
          width: 14,
          height: 14,
          background: 'var(--status-success)',
          border: '2px solid var(--card)',
          transform: 'translateY(-50%)',
        }}
      />
    </Card>
  )
}
