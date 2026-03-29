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
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useExecutionStore } from '@/stores/executionStore'

const highlightClassName = 'rounded-sm bg-yellow-300 px-0.5 text-black transition-colors data-[active-search-hit=true]:bg-amber-400 data-[active-search-hit=true]:ring-1 data-[active-search-hit=true]:ring-amber-700'

export function RuntimeDataViewer({ nodeId }: { nodeId: string }) {
  const output = useExecutionStore((s) => s.nodeOutputs[nodeId])
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())

  const hasMatch = useMemo(() => {
    if (!output || !deferredQuery) return true
    return treeContainsMatch('', output.data, deferredQuery)
  }, [output, deferredQuery])

  useEffect(() => {
    setQuery('')
    setMatchCount(0)
    setActiveMatchIndex(0)
  }, [nodeId])

  useEffect(() => {
    if (!deferredQuery || !hasMatch) {
      setMatchCount(0)
      setActiveMatchIndex(0)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const hits = getSearchHits(contentRef.current)
      setMatchCount(hits.length)
      setActiveMatchIndex((current) => {
        if (hits.length === 0) return 0
        return current >= hits.length ? 0 : current
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [deferredQuery, hasMatch, output])

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

  const jumpToPreviousMatch = useCallback(() => {
    if (matchCount === 0) return
    setActiveMatchIndex((current) => (current - 1 < 0 ? matchCount - 1 : current - 1))
  }, [matchCount])

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (event.shiftKey) {
      jumpToPreviousMatch()
      return
    }
    jumpToMatch()
  }, [jumpToMatch, jumpToPreviousMatch])

  return (
    <div className="grid min-w-0 gap-3">
      <div>
        <div className="text-xs font-medium text-foreground">Latest Response</div>
        <div className="text-[11px] text-muted-foreground">
          {output ? 'The latest payload received by this node is shown below.' : 'This node has no runtime payload yet.'}
        </div>
      </div>

      {output && (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-[220px] sm:max-w-[280px]">
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
              <div className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground sm:ml-auto">
                <button
                  type="button"
                  onClick={jumpToPreviousMatch}
                  disabled={matchCount === 0}
                  className="inline-flex size-6 items-center justify-center rounded border border-border/60 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title="Previous match (Shift+Enter)"
                >
                  <ChevronUp className="size-3" />
                </button>
                <span className="min-w-[32px] text-center">{matchCount > 0 ? `${activeMatchIndex + 1}/${matchCount}` : '0/0'}</span>
                <button
                  type="button"
                  onClick={jumpToMatch}
                  disabled={matchCount === 0}
                  className="inline-flex size-6 items-center justify-center rounded border border-border/60 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title="Next match (Enter)"
                >
                  <ChevronDown className="size-3" />
                </button>
                <span className="hidden whitespace-nowrap text-[10px] text-muted-foreground/80 xl:inline">
                  Shift+Enter / Enter
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 overflow-hidden rounded-md border border-border/70 bg-muted/20">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
              <span className="truncate">{output.messageName?.split('.').pop() ?? 'Message'}</span>
              {output.duration !== undefined && <span>{output.duration}ms</span>}
            </div>
            <div ref={contentRef} className="max-h-[420px] overflow-y-auto overflow-x-hidden px-3 py-3">
              {hasMatch ? (
                <div className="pr-2">
                  <JsonTree name="" value={output.data} defaultOpen searchQuery={deferredQuery} />
                </div>
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
  const formattedName = formatFieldName(name)

  if (!isContainer(value)) {
    const primitiveText = formatPrimitive(value)
    const leafText = getLeafSearchText(name, value)

    return (
      <div className="min-w-0 break-all whitespace-pre-wrap leading-5 text-xs">
        {searchQuery ? (
          <span className="min-w-0 break-all whitespace-pre-wrap text-foreground">
            {highlightText(leafText, searchQuery)}
          </span>
        ) : (
          <>
            {formattedName ? <span className="min-w-0 break-all whitespace-pre-wrap text-[#7aa2f7]">{formattedName}</span> : null}
            <span className={formattedName ? 'ml-1 min-w-0 break-all whitespace-pre-wrap text-foreground' : 'min-w-0 break-all whitespace-pre-wrap text-foreground'}>
              {primitiveText}
            </span>
          </>
        )}
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)

  return (
    <div className="min-w-0 break-all whitespace-pre-wrap leading-5 text-xs">
      <button
        type="button"
        className="flex w-full min-w-0 flex-wrap items-start gap-1 break-all text-left text-foreground"
        onClick={() => {
          if (!forceOpen) setOpen((current) => !current)
        }}
      >
        <span className="text-muted-foreground">{isOpen ? 'v' : '>'}</span>
        {formattedName ? <span className="min-w-0 break-all whitespace-pre-wrap text-[#7aa2f7]">{highlightText(formattedName, searchQuery)}</span> : null}
        <span className="min-w-0 break-all whitespace-pre-wrap text-muted-foreground">{summarizeContainer(value)}</span>
      </button>
      {isOpen && (
        <div className="ml-4 min-w-0 border-l border-border/60 pl-3">
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
  const nextScrollTop = Math.max(targetTop - container.clientHeight / 2 + targetRect.height / 2, 0)

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

function formatFieldName(name: string): string {
  return name ? `${name}:` : ''
}

function getLeafSearchText(name: string, value: unknown): string {
  return `${formatFieldName(name)}${formatPrimitive(value)}`
}

function treeContainsMatch(name: string, value: unknown, query: string): boolean {
  if (name && textMatches(formatFieldName(name), query)) return true
  if (!isContainer(value)) return textMatches(getLeafSearchText(name, value), query)
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
