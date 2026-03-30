import { useCanvasStore, type RequestNodeData } from '@/stores/canvasStore'
import { useProtoStore, type FieldInfo, type MessageInfo } from '@/stores/protoStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSavedConnectionStore } from '@/stores/savedConnectionStore'
import { combineRoute, splitRoute } from '@/types/frame'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { EnumSelector } from './inputs/EnumSelector'
import { NestedEditor } from './inputs/NestedEditor'
import { RepeatedEditor } from './inputs/RepeatedEditor'
import { MapEditor } from './inputs/MapEditor'

interface FieldEditorProps {
  nodeId: string
}

export function FieldEditor({ nodeId }: FieldEditorProps) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const getMessageByName = useProtoStore((s) => s.getMessageByName)
  const routeMappings = useProtoStore((s) => s.routeMappings)
  const routeFields = useConnectionStore((s) => s.routeFields)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const getConnection = useSavedConnectionStore((s) => s.getConnection)

  const activeConnection = activeConnectionId ? getConnection(activeConnectionId) : undefined
  const isPomelo = activeConnection?.frameConfig?.parserMode === 'pomelo'
  const isThriftCodec = activeConnection?.codec === 'thrift'

  if (!node || !('messageName' in node.data)) return null

  const data = node.data as RequestNodeData
  const message = getMessageByName(data.messageName)
  if (!message) {
    return (
      <div className="text-xs text-muted-foreground">
        Message definition not found: {data.messageName}
      </div>
    )
  }

  const setFieldValue = (name: string, value: unknown) => {
    updateNodeData(nodeId, {
      fields: { ...data.fields, [name]: value },
    })
  }

  const routeValues = routeFields.length > 0
    ? splitRoute(data.route ?? 0, routeFields)
    : null

  const handleRouteFieldChange = (fieldName: string, val: number) => {
    if (!routeValues) return
    const newValues = { ...routeValues, [fieldName]: val }
    updateNodeData(nodeId, { route: combineRoute(newValues, routeFields) })
  }

  const routeFromBrowser = routeMappings.some(
    (m) => m.requestMsg === data.messageName && (m.route !== 0 || !!m.stringRoute),
  )

  return (
    <div className="grid gap-3">
      {isPomelo ? (
        <div className="grid gap-2">
          <Label htmlFor={`route-${nodeId}`}>Route</Label>
          {routeFromBrowser && (
            <span className="text-xs text-muted-foreground">(Configured by protocol browser)</span>
          )}
          <Input
            id={`route-${nodeId}`}
            value={data.stringRoute ?? ''}
            onChange={(e) => updateNodeData(nodeId, { stringRoute: e.target.value })}
            placeholder="game.handler.login"
            disabled={routeFromBrowser}
          />
        </div>
      ) : routeFields.length > 0 ? (
        <div className="grid gap-2">
          <Label>Route</Label>
          {routeFromBrowser && (
            <span className="text-xs text-muted-foreground">(Configured by protocol browser)</span>
          )}
          <div className="flex items-center gap-2">
            {routeFields.map((rf) => (
              <div key={rf.name} className="grid flex-1 gap-1">
                <span className="text-xs uppercase text-muted-foreground">{rf.name}</span>
                <Input
                  value={routeValues?.[rf.name] ?? 0}
                  onChange={(e) => handleRouteFieldChange(rf.name, Number(e.target.value) || 0)}
                  disabled={routeFromBrowser}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor={`route-${nodeId}`}>Route</Label>
          {routeFromBrowser && (
            <span className="text-xs text-muted-foreground">(Configured by protocol browser)</span>
          )}
          <Input
            id={`route-${nodeId}`}
            value={data.route ?? 0}
            onChange={(e) => updateNodeData(nodeId, { route: Number(e.target.value) })}
            disabled={routeFromBrowser}
          />
        </div>
      )}

      <Separator />

      {message.Fields?.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={data.fields[field.name]}
          onChange={(v) => setFieldValue(field.name, v)}
          getMessage={getMessageByName}
          showRequiredMarker={isThriftCodec && !field.isOptional}
        />
      ))}
    </div>
  )
}

interface FieldInputProps {
  field: FieldInfo
  value: unknown
  onChange: (value: unknown) => void
  getMessage: (name: string) => MessageInfo | undefined
  showRequiredMarker: boolean
}

function FieldInput({ field, value, onChange, getMessage, showRequiredMarker }: FieldInputProps) {
  if (field.oneofName) return null

  if (field.isMap) {
    return (
      <div className="grid gap-2">
        <FieldLabel
          fieldName={field.name}
          typeLabel={`map<${field.mapKey}, ${field.mapValue}>`}
          showRequiredMarker={showRequiredMarker}
        />
        <MapEditor
          value={(value as Record<string, unknown>) || {}}
          onChange={onChange}
          keyType={field.mapKey || 'string'}
          valueType={field.mapValue || 'string'}
        />
      </div>
    )
  }

  if (field.isRepeated) {
    return (
      <div className="grid gap-2">
        <FieldLabel
          fieldName={field.name}
          typeLabel={`repeated ${field.type}`}
          showRequiredMarker={showRequiredMarker}
        />
        <RepeatedEditor
          value={(value as unknown[]) || []}
          onChange={onChange}
          field={field}
          getMessage={getMessage}
        />
      </div>
    )
  }

  if (field.kind === 'message') {
    const msgDef = getMessage(field.type)
    return (
      <div className="grid gap-2">
        <FieldLabel
          fieldName={field.name}
          typeLabel={field.type.split('.').pop()}
          showRequiredMarker={showRequiredMarker}
        />
        <NestedEditor
          value={(value as Record<string, unknown>) || {}}
          onChange={onChange}
          message={msgDef}
          getMessage={getMessage}
        />
      </div>
    )
  }

  if (field.kind === 'enum') {
    return (
      <div className="grid gap-2">
        <FieldLabel
          fieldName={field.name}
          showRequiredMarker={showRequiredMarker}
        />
        <EnumSelector
          value={value}
          onChange={onChange}
          enumType={field.type}
        />
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <FieldLabel
        fieldName={field.name}
        typeLabel={field.type}
        showRequiredMarker={showRequiredMarker}
      />
      <ScalarInput type={field.type} value={value} onChange={onChange} />
    </div>
  )
}

function FieldLabel({
  fieldName,
  typeLabel,
  showRequiredMarker,
}: {
  fieldName: string
  typeLabel?: string
  showRequiredMarker: boolean
}) {
  return (
    <Label>
      {fieldName}
      {showRequiredMarker && <span className="ml-1 text-destructive">*</span>}
      {typeLabel && <span className="text-xs text-muted-foreground"> {typeLabel}</span>}
    </Label>
  )
}

function ScalarInput({
  type,
  value,
  onChange,
}: {
  type: string
  value: unknown
  onChange: (v: unknown) => void
}) {
  switch (type) {
    case 'bool':
      return (
        <Switch
          checked={!!value}
          onCheckedChange={(v) => onChange(v)}
        />
      )
    case 'string':
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'bytes':
      return (
        <Input
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
          placeholder="hex bytes"
        />
      )
    case 'float':
    case 'double':
      return (
        <Input
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      )
    default:
      return (
        <Input
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      )
  }
}