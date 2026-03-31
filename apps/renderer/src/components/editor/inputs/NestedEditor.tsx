import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { MessageInfo } from '@/stores/protoStore'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { NumberInput } from './NumberInput'
import { isLongScalarType, isStringBackedScalarType } from './scalarTypes'

interface NestedEditorProps {
  value: Record<string, unknown>
  onChange: (value: unknown) => void
  message: MessageInfo | undefined
  getMessage: (name: string) => MessageInfo | undefined
}

export function NestedEditor({ value, onChange, message, getMessage }: NestedEditorProps) {
  const [expanded, setExpanded] = useState(false)

  if (!message) {
    return (
      <span className="text-[10px] text-muted-foreground">
        未知 Message 类型
      </span>
    )
  }

  const setField = (name: string, v: unknown) => {
    onChange({ ...value, [name]: v })
  }

  return (
    <div className="rounded border border-border pl-2">
      <div
        className="flex cursor-pointer items-center gap-1 py-1"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="text-[10px] text-muted-foreground">
          {message.ShortName}
        </span>
      </div>

      {expanded && (
        <div className="space-y-2 pb-2 pr-2">
          {message.Fields?.map((field) => {
            if (field.kind === 'message') {
              const nestedMsg = getMessage(field.type)
              return (
                <div key={field.name} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">
                    {field.name}
                  </Label>
                  <NestedEditor
                    value={(value[field.name] as Record<string, unknown>) || {}}
                    onChange={(v) => setField(field.name, v)}
                    message={nestedMsg}
                    getMessage={getMessage}
                  />
                </div>
              )
            }

            return (
              <div key={field.name} className="space-y-0.5">
                <Label className="text-[10px] text-muted-foreground">
                  {field.name}
                </Label>
                <SimpleInput
                  type={field.type}
                  value={value[field.name]}
                  onChange={(v) => setField(field.name, v)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SimpleInput({
  type,
  value,
  onChange,
}: {
  type: string
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (type === 'bool') {
    return <Switch checked={!!value} onCheckedChange={onChange} />
  }
  if (isStringBackedScalarType(type)) {
    return (
      <Input
        value={(value as string | number) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`h-6 text-[10px]${isLongScalarType(type) ? ' font-mono' : ''}`}
      />
    )
  }
  return <NumberInput value={value as number} onChange={onChange} />
}
