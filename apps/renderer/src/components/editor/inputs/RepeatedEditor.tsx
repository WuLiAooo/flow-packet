import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FieldInfo, MessageInfo } from '@/stores/protoStore'
import { NestedEditor } from './NestedEditor'
import { NumberInput } from './NumberInput'
import { getDefaultScalarValue, isLongScalarType, isStringBackedScalarType } from './scalarTypes'

interface RepeatedEditorProps {
  value: unknown[]
  onChange: (value: unknown) => void
  field: FieldInfo
  getMessage: (name: string) => MessageInfo | undefined
}

export function RepeatedEditor({ value, onChange, field, getMessage }: RepeatedEditorProps) {
  const addItem = () => {
    onChange([...value, getDefaultScalarValue(field.type, field.kind)])
  }

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, v: unknown) => {
    const updated = [...value]
    updated[index] = v
    onChange(updated)
  }

  return (
    <div className="space-y-1 rounded border border-border p-1.5">
      {value.map((item, i) => (
        <div key={i} className="flex items-start gap-1">
          <span className="shrink-0 pt-1 text-[10px] text-muted-foreground">
            [{i}]
          </span>
          <div className="flex-1">
            {field.kind === 'message' ? (
              <NestedEditor
                value={(item as Record<string, unknown>) || {}}
                onChange={(v) => updateItem(i, v)}
                message={getMessage(field.type)}
                getMessage={getMessage}
              />
            ) : isStringBackedScalarType(field.type) ? (
              <Input
                value={(item as string | number) ?? ''}
                onChange={(e) => updateItem(i, e.target.value)}
                className={`h-6 text-[10px]${isLongScalarType(field.type) ? ' font-mono' : ''}`}
              />
            ) : (
              <NumberInput
                value={item as number}
                onChange={(v) => updateItem(i, v)}
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 shrink-0 p-0"
            onClick={() => removeItem(i)}
          >
            <Trash2 className="h-3 w-3" style={{ color: 'var(--status-error)' }} />
          </Button>
        </div>
      ))}

      <Button variant="ghost" size="sm" className="h-6 w-full text-[10px]" onClick={addItem}>
        <Plus className="mr-1 h-3 w-3" /> 添加
      </Button>
    </div>
  )
}
