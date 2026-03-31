import { useEffect, useRef, useState } from 'react'
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

interface MapRow {
  id: string
  key: string
  value: unknown
}

let nextMapRowId = 0

function createMapRow(key: string, value: unknown): MapRow {
  nextMapRowId += 1
  return {
    id: `map-row-${nextMapRowId}`,
    key,
    value,
  }
}

function buildRowsFromValue(value: Record<string, unknown>, previousRows: MapRow[] = []): MapRow[] {
  const remainingRows = [...previousRows]

  return Object.entries(value).map(([entryKey, entryValue]) => {
    const matchedIndex = remainingRows.findIndex((row) => row.key === entryKey)
    if (matchedIndex === -1) {
      return createMapRow(entryKey, entryValue)
    }

    const [matchedRow] = remainingRows.splice(matchedIndex, 1)
    return { ...matchedRow, value: entryValue }
  })
}

function buildValueFromRows(rows: MapRow[]): Record<string, unknown> {
  const nextValue: Record<string, unknown> = {}
  for (const row of rows) {
    nextValue[row.key] = row.value
  }
  return nextValue
}

function getNextPlaceholderKey(rows: MapRow[]): string {
  const existingKeys = new Set(rows.map((row) => row.key))
  let index = rows.length
  let candidate = `key${index}`

  while (existingKeys.has(candidate)) {
    index += 1
    candidate = `key${index}`
  }

  return candidate
}

export function MapEditor({ value, onChange, keyType, valueType }: MapEditorProps) {
  const [rows, setRows] = useState<MapRow[]>(() => buildRowsFromValue(value))
  const skipSyncRef = useRef(false)

  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false
      return
    }
    setRows((previousRows) => buildRowsFromValue(value, previousRows))
  }, [value])

  const commitRows = (nextRows: MapRow[]) => {
    skipSyncRef.current = true
    setRows(nextRows)
    onChange(buildValueFromRows(nextRows))
  }

  const addEntry = () => {
    const key = getNextPlaceholderKey(rows)
    const defaultValue = valueType === 'string' ? '' : 0
    commitRows([...rows, createMapRow(key, defaultValue)])
  }

  const removeEntry = (rowId: string) => {
    commitRows(rows.filter((row) => row.id !== rowId))
  }

  const updateKey = (rowId: string, newKey: string) => {
    const currentRow = rows.find((row) => row.id === rowId)
    if (!currentRow || newKey === currentRow.key) return
    if (rows.some((row) => row.id !== rowId && row.key === newKey)) return

    commitRows(rows.map((row) => (row.id === rowId ? { ...row, key: newKey } : row)))
  }

  const updateValue = (rowId: string, nextValue: unknown) => {
    commitRows(rows.map((row) => (row.id === rowId ? { ...row, value: nextValue } : row)))
  }

  return (
    <div className="space-y-1 rounded border border-border p-1.5">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Input
              value={row.key}
              onChange={(e) => updateKey(row.id, e.target.value)}
              className="h-6 w-full text-[10px]"
              placeholder={keyType}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">:</span>
          <div className="min-w-0 flex-1">
            {valueType === 'string' ? (
              <Input
                value={(row.value as string) ?? ''}
                onChange={(e) => updateValue(row.id, e.target.value)}
                className="h-6 w-full text-[10px]"
              />
            ) : (
              <NumberInput
                value={row.value as number}
                onChange={(nextValue) => updateValue(row.id, nextValue)}
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={() => removeEntry(row.id)}
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
