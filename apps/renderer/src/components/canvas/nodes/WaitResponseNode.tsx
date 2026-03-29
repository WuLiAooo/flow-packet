import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import type { WaitResponseNodeData } from '@/stores/canvasStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useExecutionStore } from '@/stores/executionStore'
import { getWaitNodeMode } from '@/lib/flowGraph'
import { NodeRuntimePreview } from './NodeRuntimePreview'

const pinColors: Record<string, string> = {
  string: 'var(--pin-string)',
  int32: 'var(--pin-int)',
  int64: 'var(--pin-int)',
  uint32: 'var(--pin-int)',
  uint64: 'var(--pin-int)',
  float: 'var(--pin-int)',
  double: 'var(--pin-int)',
  bool: 'var(--pin-bool)',
}

function getPinColor(type: string): string {
  return pinColors[type] || 'var(--pin-message)'
}

export function WaitResponseNode({ id, data, selected }: NodeProps<Node<WaitResponseNodeData>>) {
  const nodeStatus = useExecutionStore((s) => s.nodeStatuses[id])
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const shortName = data.messageName.split('.').pop() || data.messageName
  const mode = getWaitNodeMode(id, nodes, edges)

  const isRunning = nodeStatus?.status === 'running'
  const isSuccess = nodeStatus?.status === 'success'
  const isError = nodeStatus?.status === 'error'

  let statusColor = ''
  if (isRunning) statusColor = 'var(--status-warning)'
  else if (isSuccess) statusColor = 'var(--status-success)'
  else if (isError) statusColor = 'var(--status-error)'

  const modeLabel = mode === 'observe' ? 'Observe Gc' : 'Wait Gc'

  return (
    <Card
      className={cn(
        'gap-0 rounded-[12px] p-0.5 transition-all duration-200',
        isRunning && 'node-pulse',
        selected && !statusColor && 'ring-1 ring-primary',
      )}
      style={{
        minWidth: 220,
        ...(statusColor ? { boxShadow: `0 0 0 1px ${statusColor}` } : {}),
      }}
    >
      <div
        className="rounded-t-md bg-emerald-500/15"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          marginBottom: 0,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--edge-exec)',
            border: '2px solid var(--card)',
            flexShrink: 0,
          }}
        />

        <Inbox className="size-3.5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-emerald-700">{shortName}</div>
          <div className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{modeLabel}</div>
        </div>

        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--edge-exec)',
            border: '2px solid var(--card)',
            flexShrink: 0,
          }}
        />
      </div>

      <CardContent className="mt-0 p-0">
        {data.expectedFields?.slice(0, 10).map((field) => (
          <div
            key={field.name}
            className="group relative flex h-8 items-center justify-between gap-1 px-2 transition-all duration-200 ease-in-out hover:bg-secondary"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <div
                className="shrink-0"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: getPinColor(field.type),
                }}
              />
              <span className="truncate text-xs text-foreground">{field.name}</span>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{field.type}</span>
          </div>
        ))}
        {(!data.expectedFields || data.expectedFields.length === 0) && (
          <div className="flex h-8 items-center px-2">
            <span className="text-xs text-muted-foreground">Waiting message, no field definitions</span>
          </div>
        )}
        {data.expectedFields && data.expectedFields.length > 10 && (
          <div className="flex h-8 items-center justify-center">
            <span className="text-xs text-muted-foreground">+{data.expectedFields.length - 10} more fields</span>
          </div>
        )}
      </CardContent>

      <NodeRuntimePreview nodeId={id} />

      <Handle
        type="target"
        position={Position.Left}
        id="exec-in"
        style={{
          top: 18,
          left: 10,
          width: 16,
          height: 16,
          background: 'transparent',
          border: 'none',
          borderRadius: '50%',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="exec-out"
        style={{
          top: 18,
          right: 10,
          width: 16,
          height: 16,
          background: 'transparent',
          border: 'none',
          borderRadius: '50%',
        }}
      />
    </Card>
  )
}
