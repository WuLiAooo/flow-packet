import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Check, ChevronRight, Copy, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useExecutionStore, type LogEntry } from '@/stores/executionStore'

const typeColors: Record<string, string> = {
  request: 'var(--pin-int)',
  response: 'var(--status-success)',
  error: 'var(--status-error)',
  info: 'hsl(var(--muted-foreground))',
}

const typeLabels: Record<string, string> = {
  request: 'REQ',
  response: 'RES',
  error: 'ERR',
  info: 'INF',
}

const COLLAPSE_THRESHOLD = 160

export function LogPanel() {
  const logs = useExecutionStore((s) => s.logs)
  const clearLogs = useExecutionStore((s) => s.clearLogs)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const filteredLogs = useMemo(() => {
    if (!deferredQuery) return logs
    return logs.filter((log) => matchesLog(log, deferredQuery))
  }, [logs, deferredQuery])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 font-mono text-[11px]">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs, messages, payloads"
            className="h-7 pr-7 pl-7 font-mono text-[11px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              title="Clear search"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {filteredLogs.length}/{logs.length}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={clearLogs}
          disabled={logs.length === 0}
        >
          <Trash2 className="size-3" />
          Clear
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="font-mono text-[11px]" style={{ padding: '8px 8px 8px 22px' }}>
          <div className="mb-2 text-[10px] text-muted-foreground">Log buffer keeps the latest 200 entries.</div>
          {logs.length === 0 && (
            <div className="text-muted-foreground">Waiting for execution...</div>
          )}
          {logs.length > 0 && filteredLogs.length === 0 && (
            <div className="text-muted-foreground">No logs match the current search.</div>
          )}
          {filteredLogs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

function LogRow({ log }: { log: LogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })

  const hasData = Object.keys(log.data).length > 0
  const summary = useMemo(() => summarizeValue(log.data), [log.data])
  const shouldCollapse = hasData && summary.length > COLLAPSE_THRESHOLD

  const handleCopy = useCallback(() => {
    const text = safeStringify(log.data)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [log.data])

  return (
    <div className="py-0.5">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{time}</span>
        <span
          className="w-8 shrink-0 text-center font-bold"
          style={{ color: typeColors[log.type] }}
        >
          {typeLabels[log.type]}
        </span>
        <span className="text-muted-foreground">[{log.nodeId}]</span>
        {log.messageName && (
          <span className="text-blue-400">{shortName(log.messageName)}</span>
        )}
        {hasData && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
            title={expanded ? 'Collapse details' : 'Expand details'}
          >
            <ChevronRight className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        )}
        {hasData && (
          <button
            onClick={handleCopy}
            className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
            title="Copy payload"
          >
            {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
          </button>
        )}
        {log.duration !== undefined && (
          <span className="ml-auto text-muted-foreground">{log.duration}ms</span>
        )}
      </div>
      {hasData && (
        expanded ? (
          <div className="mt-1 pl-20">
            <JsonTree name="" value={log.data} defaultOpen />
          </div>
        ) : (
          <div className={cn('mt-0.5 pl-20 text-foreground', shouldCollapse && 'truncate')}>
            {summary}
          </div>
        )
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
      <div className="leading-5">
        {name ? <span className="text-[#7aa2f7]">{name}: </span> : null}
        <span className="text-foreground">{formatPrimitive(value)}</span>
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)

  return (
    <div className="leading-5">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
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

function shortName(fullName: string): string {
  const parts = fullName.split('.')
  return parts[parts.length - 1]
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

function summarizeValue(value: unknown, depth = 0): string {
  if (!isContainer(value)) return formatPrimitive(value)
  if (depth >= 1) return summarizeContainer(value)

  if (Array.isArray(value)) {
    const items = value.slice(0, 4).map((item) => summarizeValue(item, 1))
    return `[${items.join(', ')}${value.length > 4 ? ', ...' : ''}]`
  }

  const parts = Object.entries(value)
    .slice(0, 6)
    .map(([key, item]) => `${key}: ${summarizeValue(item, 1)}`)
  return `{ ${parts.join(', ')}${Object.keys(value).length > 6 ? ', ...' : ''} }`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function matchesLog(log: LogEntry, query: string): boolean {
  if (!query) return true
  const haystack = [
    log.nodeId,
    log.type,
    log.messageName ?? '',
    safeStringify(log.data),
  ].join(' ').toLowerCase()
  return haystack.includes(query)
}
