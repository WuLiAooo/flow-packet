import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NumberInput } from './NumberInput'

interface MapEditorProps {
  value: Record<string, unknown>
  onChange: (value: unknown) => void
  keyType: string
  valueType: string
}

export function MapEditor({ value, onChange, keyType, valueType }: MapEditorProps) {
  const entries = Object.entries(value)

  const addEntry = () => {
    const key = `key${entries.length}`
    const defaultValue = valueType === 'string' ? '' : 0
    onChange({ ...value, [key]: defaultValue })
  }

  const removeEntry = (key: string) => {
    const updated = { ...value }
    delete updated[key]
    onChange(updated)
  }

  const updateKey = (oldKey: string, newKey: string) => {
    if (newKey === oldKey) return

    const updated: Record<string, unknown> = {}
    for (const [currentKey, currentValue] of Object.entries(value)) {
      updated[currentKey === oldKey ? newKey : currentKey] = currentValue
    }
    onChange(updated)
  }

  const updateValue = (key: string, nextValue: unknown) => {
    onChange({ ...value, [key]: nextValue })
  }

  return (
    <div className="space-y-1 rounded border border-border p-1.5">
      {entries.map(([key, currentValue], index) => (
        <div key={`${index}-${keyType}-${valueType}`} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Input
              value={key}
              onChange={(e) => updateKey(key, e.target.value)}
              className="h-6 w-full text-[10px]"
              placeholder={keyType}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">:</span>
          <div className="min-w-0 flex-1">
            {valueType === 'string' ? (
              <Input
                value={(currentValue as string) ?? ''}
                onChange={(e) => updateValue(key, e.target.value)}
                className="h-6 w-full text-[10px]"
              />
            ) : (
              <NumberInput
                value={currentValue as number}
                onChange={(nextValue) => updateValue(key, nextValue)}
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={() => removeEntry(key)}
          >
            <Trash2 className="h-3 w-3" style={{ color: 'var(--status-error)' }} />
          </Button>
        </div>
      ))}

      <Button variant="ghost" size="sm" className="h-6 w-full text-[10px]" onClick={addEntry}>
        <Plus className="mr-1 h-3 w-3" /> 添加
      </Button>
    </div>
  )
}