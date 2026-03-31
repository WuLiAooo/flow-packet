import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberInput } from './NumberInput'
import type { OneofInfo, FieldInfo } from '@/stores/protoStore'
import { getDefaultScalarValue, isLongScalarType, isStringBackedScalarType } from './scalarTypes'

interface OneofEditorProps {
  oneof: OneofInfo
  fields: FieldInfo[]
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
}

export function OneofEditor({ oneof, fields, values, onChange }: OneofEditorProps) {
  const activeField = oneof.fields.find((f) => values[f] !== undefined) || oneof.fields[0]

  const handleSwitch = (fieldName: string) => {
    oneof.fields.forEach((f) => {
      if (f !== fieldName) onChange(f, undefined)
    })

    const field = fields.find((f) => f.name === fieldName)
    if (field) {
      onChange(fieldName, getDefaultScalarValue(field.type, field.kind))
    }
  }

  const activeFieldDef = fields.find((f) => f.name === activeField)

  return (
    <div className="space-y-1.5 rounded border border-border p-2">
      <Label className="text-[10px] text-muted-foreground">
        oneof {oneof.name}
      </Label>
      <Select value={activeField} onValueChange={handleSwitch}>
        <SelectTrigger className="h-6 text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {oneof.fields.map((f) => (
            <SelectItem key={f} value={f} className="text-[10px]">
              {f}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {activeFieldDef && (
        <div>
          {isStringBackedScalarType(activeFieldDef.type) ? (
            <Input
              value={(values[activeField] as string | number) ?? ''}
              onChange={(e) => onChange(activeField, e.target.value)}
              className={`h-6 text-[10px]${isLongScalarType(activeFieldDef.type) ? ' font-mono' : ''}`}
            />
          ) : (
            <NumberInput
              value={values[activeField] as number}
              onChange={(v) => onChange(activeField, v)}
            />
          )}
        </div>
      )}
    </div>
  )
}
