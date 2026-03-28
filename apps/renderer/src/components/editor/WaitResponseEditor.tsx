import { useCanvasStore, type WaitResponseNodeData } from '@/stores/canvasStore'
import { useProtoStore } from '@/stores/protoStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSavedConnectionStore } from '@/stores/savedConnectionStore'
import { combineRoute, splitRoute } from '@/types/frame'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface WaitResponseEditorProps {
  nodeId: string
}

export function WaitResponseEditor({ nodeId }: WaitResponseEditorProps) {
  const node = useCanvasStore((s) => s.nodes.find((item) => item.id === nodeId))
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const getMessageByName = useProtoStore((s) => s.getMessageByName)
  const routeFields = useConnectionStore((s) => s.routeFields)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const getConnection = useSavedConnectionStore((s) => s.getConnection)

  const isPomelo = activeConnectionId
    ? getConnection(activeConnectionId)?.frameConfig?.parserMode === 'pomelo'
    : false

  if (!node || node.type !== 'waitResponseNode') return null

  const data = node.data as WaitResponseNodeData
  const message = getMessageByName(data.messageName)

  const routeValues = routeFields.length > 0
    ? splitRoute(data.route ?? 0, routeFields)
    : null

  const handleRouteFieldChange = (fieldName: string, value: number) => {
    if (!routeValues) return
    const newValues = { ...routeValues, [fieldName]: value }
    updateNodeData(nodeId, { route: combineRoute(newValues, routeFields) })
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label>Message</Label>
        <Input value={data.messageName} readOnly />
        {message && (
          <span className="text-xs text-muted-foreground">
            {message.Fields?.length ?? 0} fields defined. Execution continues after this message is received.
          </span>
        )}
      </div>

      {isPomelo ? (
        <div className="grid gap-2">
          <Label htmlFor={`wait-route-${nodeId}`}>Route Match</Label>
          <Input
            id={`wait-route-${nodeId}`}
            value={data.stringRoute ?? ''}
            onChange={(e) => updateNodeData(nodeId, { stringRoute: e.target.value })}
            placeholder="game.push.login"
          />
        </div>
      ) : routeFields.length > 0 ? (
        <div className="grid gap-2">
          <Label>Route Match</Label>
          <div className="flex items-center gap-2">
            {routeFields.map((field) => (
              <div key={field.name} className="grid flex-1 gap-1">
                <span className="text-xs uppercase text-muted-foreground">{field.name}</span>
                <Input
                  value={routeValues?.[field.name] ?? 0}
                  onChange={(e) => handleRouteFieldChange(field.name, Number(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={`wait-route-${nodeId}`}>Route Match</Label>
          <Input
            id={`wait-route-${nodeId}`}
            value={data.route ?? 0}
            onChange={(e) => updateNodeData(nodeId, { route: Number(e.target.value) || 0 })}
          />
        </div>
      )}
    </div>
  )
}
