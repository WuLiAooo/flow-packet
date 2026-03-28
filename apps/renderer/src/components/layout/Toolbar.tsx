import { Play, ArrowLeft, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { useConnectionStore } from '@/stores/connectionStore'
import { useExecutionStore } from '@/stores/executionStore'
import { useSavedConnectionStore } from '@/stores/savedConnectionStore'
import { executeFlow, connectTCP } from '@/services/api'
import { useSessionStatusStore } from '@/stores/sessionStatusStore'
import { useCanvasStore, type BeginNodeData } from '@/stores/canvasStore'
import { formatValidationMessage, getExecutableFlowFromBegin } from '@/lib/flowGraph'
import { toast } from 'sonner'

const stateColors: Record<string, string> = {
  disconnected: 'hsl(var(--muted-foreground))',
  connecting: 'var(--status-warning)',
  connected: 'var(--status-success)',
  reconnecting: 'var(--status-warning)',
}

const stateLabels: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
}

interface ToolbarProps {
  onBack?: () => void
}

export function Toolbar({ onBack }: ToolbarProps) {
  const connState = useConnectionStore((s) => s.state)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const execStatus = useExecutionStore((s) => s.status)
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const getConnection = useSavedConnectionStore((s) => s.getConnection)
  const getSessionStatus = useSessionStatusStore((s) => s.getStatus)

  const isConnected = connState === 'connected'
  const isDisconnected = connState === 'disconnected'

  const handleReconnect = async () => {
    if (!activeConnectionId) return
    const connection = getConnection(activeConnectionId)
    if (!connection) return

    useConnectionStore.getState().setState('connecting')

    const isDueProtocol = connection.frameConfig?.fields?.some(
      (f) => f.name.toLowerCase() === 'header' && f.bytes === 1,
    ) ?? false
    const connectTimeout = useConnectionStore.getState().config.timeout || 5000

    try {
      await connectTCP(connection.host, connection.port, {
        connectionId: activeConnectionId,
        protocol: connection.protocol,
        timeout: connectTimeout,
        reconnect: true,
        heartbeat: isDueProtocol,
        frameFields: connection.frameConfig?.fields,
        byteOrder: connection.frameConfig?.byteOrder,
        parserMode: connection.frameConfig?.parserMode,
      })
      toast.success('Reconnect successful', {
        description: `Connected to ${connection.host}:${connection.port}`,
      })
    } catch (err) {
      toast.error('Reconnect failed', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleRun = async () => {
    if (!isConnected || execStatus === 'running' || nodes.length === 0 || !activeConnectionId) return

    const beginNode = nodes.find((node) => node.type === 'beginNode')
    const beginData = beginNode?.data as BeginNodeData | undefined
    const deviceId = typeof beginData?.deviceId === 'string' ? beginData.deviceId.trim() : ''
    if (!deviceId) {
      toast.error('Begin deviceId required', {
        description: 'Double-click BeginNode and configure the deviceId before running this chain.',
      })
      return
    }

    const sessionStatus = getSessionStatus(activeConnectionId, deviceId)
    if (sessionStatus?.state !== 'ready') {
      toast.error('Begin session not ready', {
        description: 'Right-click BeginNode and choose Login before running this chain.',
      })
      return
    }

    const executable = getExecutableFlowFromBegin(nodes, edges)
    if (!executable.validation.valid) {
      toast.error('Invalid flow', {
        description: formatValidationMessage(executable.validation),
      })
      return
    }

    try {
      const flowNodes = executable.nodes.map((node) => {
        if (node.type === 'requestNode') {
          return {
            id: node.id,
            type: 'request',
            messageName: node.data.messageName,
            route: node.data.route,
            stringRoute: node.data.stringRoute,
            fields: node.data.fields,
          }
        }
        return {
          id: node.id,
          type: 'wait_response',
          messageName: node.data.messageName,
          route: node.data.route,
          stringRoute: node.data.stringRoute,
          fields: {},
        }
      })
      const flowEdges = executable.edges.map((edge) => ({ source: edge.source, target: edge.target }))
      await executeFlow(flowNodes, flowEdges, activeConnectionId, deviceId)
    } catch {
      // handled by event
    }
  }

  return (
    <div className="flex w-full items-center gap-2">
      {onBack && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
      )}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2"
        disabled={!isConnected || execStatus === 'running'}
        onClick={handleRun}
      >
        <Play className="h-3.5 w-3.5" style={{ color: 'var(--status-success)' }} />
        <span className="text-xs">Run</span>
      </Button>

      <div className="flex items-center gap-1.5">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: stateColors[connState] }}
        />
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
          {stateLabels[connState]}
        </Badge>
        {isDisconnected && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleReconnect}
            title="Reconnect"
          >
            <RotateCw className="h-3 w-3" />
          </Button>
        )}
      </div>

      <ThemeToggle />
    </div>
  )
}



