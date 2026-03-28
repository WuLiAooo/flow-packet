import { useExecutionStore } from '@/stores/executionStore'

export function NodeRuntimePreview({ nodeId }: { nodeId: string }) {
  const output = useExecutionStore((s) => s.nodeOutputs[nodeId])

  if (!output) return null

  return (
    <div className="border-t border-border/70 px-3 py-2">
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        Last Response
      </div>
      <div className="mt-1 truncate text-xs text-foreground">
        {output.messageName?.split('.').pop() ?? 'Message'}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">
        {summarizeObject(output.data)}
      </div>
    </div>
  )
}

function summarizeObject(value: Record<string, unknown>): string {
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'

  return entries
    .slice(0, 3)
    .map(([key, item]) => `${key}: ${summarizeValue(item)}`)
    .join(', ')
}

function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).length}}`
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return String(value)
}
