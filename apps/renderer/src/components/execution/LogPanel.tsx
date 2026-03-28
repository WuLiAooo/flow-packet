import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { Check, ChevronDown, ChevronRight, ChevronUp, Copy, Search, Trash2, X } from 'lucide-react'
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
const highlightClassName = 'rounded-sm bg-yellow-300 px-0.5 text-black transition-colors data-[active-search-hit=true]:bg-amber-400 data-[active-search-hit=true]:ring-1 data-[active-search-hit=true]:ring-amber-700'

export function LogPanel() {
  const logs = useExecutionStore((s) => s.logs)
  const clearLogs = useExecutionStore((s) => s.clearLogs)
  const [query, setQuery] = useState('')
  const [totalMatches, setTotalMatches] = useState(0)
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const filteredLogs = useMemo(() => {
    if (!deferredQuery) return logs
    return logs.filter((log) => matchesLog(log, deferredQuery))
  }, [logs, deferredQuery])

  const hasSearch = deferredQuery.length > 0
  const matchLabel = hasSearch
    ? totalMatches > 0
      ? `${activeMatchIndex + 1}/${totalMatches}`
      : '0/0'
    : '0/0'

  useEffect(() => {
    if (!hasSearch) {
      setTotalMatches(0)
      setActiveMatchIndex(0)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const hits = getSearchHits(contentRef.current)
      setTotalMatches(hits.length)
      setActiveMatchIndex((current) => {
        if (hits.length === 0) return 0
        return current >= hits.length ? 0 : current
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasSearch, filteredLogs])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const hits = getSearchHits(contentRef.current)
      hits.forEach((hit, index) => {
        if (hasSearch && index === activeMatchIndex) {
          hit.dataset.activeSearchHit = 'true'
        } else {
          delete hit.dataset.activeSearchHit
        }
      })

      if (!hasSearch || hits.length === 0) return
      const target = hits[activeMatchIndex] ?? hits[0]
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeMatchIndex, hasSearch, filteredLogs])

  const jumpToMatch = useCallback((direction: 1 | -1) => {
    if (totalMatches === 0) return
    setActiveMatchIndex((current) => {
      const next = current + direction
      if (next < 0) return totalMatches - 1
      if (next >= totalMatches) return 0
      return next
    })
  }, [totalMatches])

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    jumpToMatch(event.shiftKey ? -1 : 1)
  }, [jumpToMatch])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 font-mono text-[11px]">
        <div className="relative min-w-[220px] flex-1 sm:max-w-[66%]">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
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
        <div className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <span>{matchLabel}</span>
          <button
            type="button"
            onClick={() => jumpToMatch(-1)}
            disabled={totalMatches === 0}
            className="inline-flex items-center rounded border border-border/60 p-1 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            title="Previous match"
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => jumpToMatch(1)}
            disabled={totalMatches === 0}
            className="inline-flex items-center rounded border border-border/60 p-1 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            title="Next match"
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">Total {logs.length}</span>
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
        <div ref={contentRef} className="font-mono text-[11px]" style={{ padding: '8px 8px 8px 22px' }}>
          <div className="mb-2 text-[10px] text-muted-foreground">Log buffer keeps the latest 200 entries.</div>
          {logs.length === 0 && (
            <div className="text-muted-foreground">Waiting for execution...</div>
          )}
          {logs.length > 0 && filteredLogs.length === 0 && (
            <div className="text-muted-foreground">No logs match the current search.</div>
          )}
          {filteredLogs.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              searchQuery={deferredQuery}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

function LogRow({
  log,
  searchQuery,
}: {
  log: LogEntry
  searchQuery: string
}) {
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
  const isSearchMode = searchQuery.length > 0
  const isExpanded = expanded || (isSearchMode && hasData)


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
        <span className="text-muted-foreground">
          [
          {highlightText(log.nodeId, searchQuery)}
          ]
        </span>
        {log.messageName && (
          <span className="text-blue-400">{highlightText(shortName(log.messageName), searchQuery)}</span>
        )}
        {hasData && (
          <button
            onClick={() => {
              if (!isSearchMode) setExpanded((value) => !value)
            }}
            className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
            title={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            <ChevronRight className={cn('size-3 transition-transform', isExpanded && 'rotate-90')} />
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
        isExpanded ? (
          <div className="mt-1 pl-20">
            <JsonTree name="" value={log.data} defaultOpen searchQuery={searchQuery} />
          </div>
        ) : (
          <div className={cn('mt-0.5 pl-20 text-foreground', shouldCollapse && 'truncate')}>
            {highlightText(summary, searchQuery)}
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
  searchQuery,
}: {
  name: string
  value: unknown
  defaultOpen?: boolean
  searchQuery: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const forceOpen = searchQuery.length > 0 && treeContainsMatch(name, value, searchQuery)
  const isOpen = open || forceOpen

  if (!isContainer(value)) {
    return (
      <div className="leading-5">
        {name ? <span className="text-[#7aa2f7]">{highlightText(name, searchQuery)}: </span> : null}
        <span className="text-foreground">{highlightText(formatPrimitive(value), searchQuery)}</span>
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
        onClick={() => {
          if (!forceOpen) setOpen((current) => !current)
        }}
      >
        <ChevronRight className={cn('size-3 transition-transform', isOpen && 'rotate-90')} />
        {name ? <span className="text-[#7aa2f7]">{highlightText(name, searchQuery)}</span> : null}
        <span className="text-muted-foreground">{summarizeContainer(value)}</span>
      </button>
      {isOpen && (
        <div className="ml-4 border-l border-border/60 pl-3">
          {entries.map(([childName, childValue]) => (
            <JsonTree key={childName} name={childName} value={childValue} searchQuery={searchQuery} />
          ))}
        </div>
      )}
    </div>
  )
}

function getSearchHits(container: HTMLDivElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll('[data-search-hit="true"]'))
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

function treeContainsMatch(name: string, value: unknown, query: string): boolean {
  if (name && textMatches(name, query)) return true
  if (!isContainer(value)) return textMatches(formatPrimitive(value), query)
  if (Array.isArray(value)) {
    return value.some((item, index) => treeContainsMatch(String(index), item, query))
  }
  return Object.entries(value).some(([key, item]) => treeContainsMatch(key, item, query))
}

function textMatches(text: string, query: string): boolean {
  return query.length > 0 && text.toLowerCase().includes(query)
}

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text
  const normalizedText = text.toLowerCase()
  const normalizedQuery = query.toLowerCase()
  if (!normalizedText.includes(normalizedQuery)) return text

  const parts: ReactNode[] = []
  let start = 0
  let index = normalizedText.indexOf(normalizedQuery, start)

  while (index !== -1) {
    if (index > start) {
      parts.push(text.slice(start, index))
    }
    const end = index + query.length
    parts.push(
      <mark key={`${index}-${end}`} data-search-hit="true" className={highlightClassName}>
        {text.slice(index, end)}
      </mark>
    )
    start = end
    index = normalizedText.indexOf(normalizedQuery, start)
  }

  if (start < text.length) {
    parts.push(text.slice(start))
  }

  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)
}







