import { useEffect } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useProtoStore } from '@/stores/protoStore'

interface EnumSelectorProps {
  value: unknown
  onChange: (value: unknown) => void
  enumType: string
}

export function EnumSelector({ value, onChange, enumType }: EnumSelectorProps) {
  const files = useProtoStore((s) => s.files)

  let enumValues: { name: string; number: number }[] = []
  for (const file of files) {
    const topLevel = file.Enums?.find((e) => (e as { name?: string; Name?: string }).name === enumType || (e as { name?: string; Name?: string }).Name === enumType)
    if (topLevel) {
      enumValues = (topLevel as { values?: { name: string; number: number }[]; Values?: { Name: string; Number: number }[] }).values
        ?? (topLevel as { values?: { name: string; number: number }[]; Values?: { Name: string; Number: number }[] }).Values?.map((item) => ({
          name: item.Name,
          number: item.Number,
        }))
        ?? []
      break
    }

    for (const msg of file.Messages || []) {
      const nested = msg.NestedEnums?.find((e) => (e as { name?: string; Name?: string }).name === enumType || (e as { name?: string; Name?: string }).Name === enumType)
      if (nested) {
        enumValues = (nested as { values?: { name: string; number: number }[]; Values?: { Name: string; Number: number }[] }).values
          ?? (nested as { values?: { name: string; number: number }[]; Values?: { Name: string; Number: number }[] }).Values?.map((item) => ({
            name: item.Name,
            number: item.Number,
          }))
          ?? []
        break
      }
    }

    if (enumValues.length > 0) break
  }

  const defaultValue = enumValues[0]?.number ?? 0
  const normalizedValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value !== ''
      ? Number(value)
      : defaultValue

  useEffect(() => {
    if (value === undefined && enumValues.length > 0) {
      onChange(defaultValue)
    }
  }, [defaultValue, enumValues.length, onChange, value])

  return (
    <Select
      value={String(normalizedValue)}
      onValueChange={(nextValue) => onChange(parseInt(nextValue, 10))}
    >
      <SelectTrigger className="h-7 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {enumValues.map((item) => (
          <SelectItem key={item.number} value={String(item.number)} className="text-xs">
            {item.name} ({item.number})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}