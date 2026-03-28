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
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useExecutionStore } from '@/stores/executionStore'

const highlightClassName = 'rounded-sm bg-yellow-300 px-0.5 text-black transition-colors data-[active-search-hit=true]:bg-amber-400 data-[active-search-hit=true]:ring-1 data-[active-search-hit=true]:ring-amber-700'

export function RuntimeDataViewer({ nodeId }: { nodeId: string }) {
  const output = useExecutionStore((s) => s.nodeOutputs[nodeId])
  const [query, setQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const matchCount = useMemo(() => {
    if (!output || !deferredQuery) return 0
    return countMatches(output.data, deferredQuery)
  }, [output, deferredQuery])

  const hasMatch = !deferredQuery || matchCount > 0

  useEffect(() => {
    if (!deferredQuery || matchCount === 0) {
      setActiveMatchIndex(0)
      return
    }

    setActiveMatchIndex((current) => (current >= matchCount ? 0 : current))
  }, [deferredQuery, matchCount])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const hits = getSearchHits(contentRef.current)
      hits.forEach((hit, index) => {
        if (deferredQuery && index === activeMatchIndex) {
          hit.dataset.activeSearchHit = 'true'
        } else {
          delete hit.dataset.activeSearchHit
        }
      })

      if (!deferredQuery || hits.length === 0) return
      const target = hits[activeMatchIndex] ?? hits[0]
      scrollSearchHitIntoView(contentRef.current, target)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeMatchIndex, deferredQuery, matchCount, output])

  const jumpToMatch = useCallback(() => {
    if (matchCount === 0) return
    setActiveMatchIndex((current) => (current + 1 >= matchCount ? 0 : current + 1))
  }, [matchCount])

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    jumpToMatch()
  }, [jumpToMatch])

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-xs font-medium text-foreground">Latest Response</div>
        <div className="text-[11px] text-muted-foreground">
          {output ? 'The latest payload received by this node is shown below.' : 'This node has no runtime payload yet.'}
        </div>
      </div>

      {output && (
        <>
          <div className="flex items-center gap-2">
            <div className="relative min-w-[270px] flex-1 max-w-[420px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search response payload"
                className="h-8 pr-7 pl-7 font-mono text-[11px]"
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
            {deferredQuery && (
              <div className="shrink-0 text-[10px] text-muted-foreground">
                {matchCount > 0 ? `${activeMatchIndex + 1}/${matchCount}` : '0/0'}
              </div>
            )}
          </div>

          <div className="rounded-md border border-border/70 bg-muted/20">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="truncate">{output.messageName?.split('.').pop() ?? 'Message'}</span>
              {output.duration !== undefined && <span>{output.duration}ms</span>}
            </div>
            <div ref={contentRef} className="max-h-[420px] overflow-y-auto px-3 py-3">
              {hasMatch ? (
                <JsonTree name="" value={output.data} defaultOpen searchQuery={deferredQuery} />
              ) : (
                <div className="text-xs text-muted-foreground">No fields match the current search.</div>
              )}
            </div>
          </div>
        </>
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
      <div className="leading-5 text-xs">
        {name ? <span className="text-[#7aa2f7]">{highlightText(name, searchQuery)}: </span> : null}
        <span className="text-foreground">{highlightText(formatPrimitive(value), searchQuery)}</span>
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
        onClick={() => {
          if (!forceOpen) setOpen((current) => !current)
        }}
      >
        <span className="text-muted-foreground">{isOpen ? 'v' : '>'}</span>
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

function scrollSearchHitIntoView(container: HTMLDivElement | null, target: HTMLElement | undefined) {
  if (!container || !target) return

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const targetTop = targetRect.top - containerRect.top + container.scrollTop
  const nextScrollTop = Math.max(targetTop - 24, 0)

  container.scrollTo({
    top: nextScrollTop,
    behavior: 'smooth',
  })
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

function countMatches(value: unknown, query: string): number {
  if (!query) return 0
  if (!isContainer(value)) {
    return countTextMatches(formatPrimitive(value), query)
  }
  if (Array.isArray(value)) {
    return value.reduce<number>((total, item, index) => total + countTextMatches(String(index), query) + countMatches(item, query), 0)
  }
  return Object.entries(value).reduce<number>(
    (total, [key, item]) => total + countTextMatches(key, query) + countMatches(item, query),
    0,
  )
}

function countTextMatches(text: string, query: string): number {
  const normalizedText = text.toLowerCase()
  if (!query || !normalizedText.includes(query)) return 0

  let count = 0
  let start = 0
  let index = normalizedText.indexOf(query, start)
  while (index !== -1) {
    count += 1
    start = index + query.length
    index = normalizedText.indexOf(query, start)
  }
  return count
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
  if (!normalizedText.includes(query)) return text

  const parts: ReactNode[] = []
  let start = 0
  let index = normalizedText.indexOf(query, start)

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
    index = normalizedText.indexOf(query, start)
  }

  if (start < text.length) {
    parts.push(text.slice(start))
  }

  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)
}

