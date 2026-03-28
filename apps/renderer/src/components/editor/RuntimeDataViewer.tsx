import { useState } from 'react'
import { useExecutionStore } from '@/stores/executionStore'

export function RuntimeDataViewer({ nodeId }: { nodeId: string }) {
  const output = useExecutionStore((s) => s.nodeOutputs[nodeId])

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-xs font-medium text-foreground">Latest Response</div>
        <div className="text-[11px] text-muted-foreground">
          {output ? 'The latest payload received by this node is shown below.' : 'This node has no runtime payload yet.'}
        </div>
      </div>

      {output && (
        <div className="rounded-md border border-border/70 bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">{output.messageName?.split('.').pop() ?? 'Message'}</span>
            {output.duration !== undefined && <span>{output.duration}ms</span>}
          </div>
          <JsonTree name="" value={output.data} defaultOpen />
        </div>
      )}
    </div>
  )
}

function JsonTree({
  name,
  value,
  defaultOpen = false,
}: {
  name: string
  value: unknown
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (!isContainer(value)) {
    return (
      <div className="leading-5 text-xs">
        {name ? <span className="text-[#7aa2f7]">{name}: </span> : null}
        <span className="text-foreground">{formatPrimitive(value)}</span>
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)

  return (
    <div className="leading-5 text-xs">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left text-foreground"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-muted-foreground">{open ? 'v' : '>'}</span>
        {name ? <span className="text-[#7aa2f7]">{name}</span> : null}
        <span className="text-muted-foreground">{summarizeContainer(value)}</span>
      </button>
      {open && (
        <div className="ml-4 border-l border-border/60 pl-3">
          {entries.map(([childName, childValue]) => (
            <JsonTree key={childName} name={childName} value={childValue} />
          ))}
        </div>
      )}
    </div>
  )
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null
}

function formatPrimitive(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return String(value)
}

function summarizeContainer(value: Record<string, unknown> | unknown[]): string {
  if (Array.isArray(value)) {
    return `[${value.length}]`
  }
  return `{${Object.keys(value).length}}`
}
