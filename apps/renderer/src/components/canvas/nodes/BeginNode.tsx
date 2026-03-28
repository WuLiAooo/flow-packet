import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Play } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { BeginNodeData } from '@/stores/canvasStore'

export function BeginNode({ data, selected }: NodeProps<Node<BeginNodeData>>) {
  const deviceId = (data.deviceId || '').trim()

  return (
    <Card
      className={selected ? 'rounded-[14px] border-primary ring-1 ring-primary' : 'rounded-[14px]'}
      style={{
        minWidth: 188,
        borderWidth: 1,
        background: 'linear-gradient(135deg, rgba(34,197,94,0.18), rgba(59,130,246,0.14))',
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600">
          <Play className="size-4 fill-current" />
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
