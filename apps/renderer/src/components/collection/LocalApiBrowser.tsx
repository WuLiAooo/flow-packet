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
import { Blocks, ChevronDown, ChevronUp, Loader2, Play, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { executeLocalGameApi, listLocalGameApis, type LocalGameApiExecuteResult, type LocalGameApiInfo } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const resultHighlightClassName = 'rounded-sm bg-yellow-300 px-0.5 text-black transition-colors data-[active-search-hit=true]:bg-amber-400 data-[active-search-hit=true]:ring-1 data-[active-search-hit=true]:ring-amber-700'
const API_ROW_HEIGHT = 92
const API_LIST_OVERSCAN = 8

function sortParamEntries(params: Record<string, string> | null) {
  return Object.entries(params ?? {}).sort((a, b) => a[0].localeCompare(b[0]))
}

function normalizeSearchText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/[\s_./:-]+/g, '')
}

function splitApiCommand(command: string) {
  const index = command.lastIndexOf('.')
  if (index < 0) {
    return {
      namespace: '',
      shortName: command,
    }
  }

  return {
    namespace: command.slice(0, index + 1),
    shortName: command.slice(index + 1),
  }
}

function buildApiSearchIndex(item: LocalGameApiInfo) {
  const { shortName } = splitApiCommand(item.cmd)
  return {
    shortName: normalizeSearchText(shortName),
    shortNameCompact: compactSearchText(shortName),
    comment: normalizeSearchText(item.comment),
    commentCompact: compactSearchText(item.comment),
  }
}

function dedupeApiItems(items: LocalGameApiInfo[]) {
  const unique = new Map<string, LocalGameApiInfo>()

  for (const item of items) {
    const existing = unique.get(item.cmd)
    if (!existing) {
      unique.set(item.cmd, item)
      continue
    }

    const existingScore = (existing.comment ? 1 : 0) + (existing.classDeclaring ? 1 : 0) + Object.keys(existing.params ?? {}).length
    const nextScore = (item.comment ? 1 : 0) + (item.classDeclaring ? 1 : 0) + Object.keys(item.params ?? {}).length
    if (nextScore > existingScore) {
      unique.set(item.cmd, item)
    }
  }

  return Array.from(unique.values())
}

function normalizeResultValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  try {
    return normalizeResultValue(JSON.parse(trimmed))
  } catch {
    return value
  }
}

function formatResultText(result: LocalGameApiExecuteResult | null) {
  if (!result) {
    return ''
  }

  const normalized = normalizeResultValue(result.parsed ?? result.rawText)
  if (typeof normalized === 'string') {
    return normalized
  }

  try {
    return JSON.stringify(normalized, null, 2)
  } catch {
    return result.rawText
  }
}

function getSearchHits(container: HTMLDivElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll('[data-search-hit="true"]'))
}

function highlightResultText(text: string, query: string): ReactNode {
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
      <mark key={`${index}-${end}`} data-search-hit="true" className={resultHighlightClassName}>
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

function renderHighlightedText(text: string, query: string) {
  if (!text) {
    return null
  }

  const keyword = query.trim()
  if (!keyword) {
    return text
  }

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const splitRegex = new RegExp(`(${escaped})`, 'giu')
  const exactRegex = new RegExp(`^${escaped}$`, 'iu')
  const parts = text.split(splitRegex)

  return parts.map((part, index) => (
    exactRegex.test(part)
      ? <mark key={`${part}-${index}`} className="rounded bg-amber-200 px-0.5 text-inherit">{part}</mark>
      : <span key={`${part}-${index}`}>{part}</span>
  ))
}

export function LocalApiBrowser() {
  const [apiItems, setApiItems] = useState<LocalGameApiInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [search, setSearch] = useState('')
  const [resultSearch, setResultSearch] = useState('')
  const [selectedCmd, setSelectedCmd] = useState('')
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<LocalGameApiExecuteResult | null>(null)
  const [loadError, setLoadError] = useState('')
  const [totalResultMatches, setTotalResultMatches] = useState(0)
  const [activeResultMatchIndex, setActiveResultMatchIndex] = useState(0)
  const [listScrollTop, setListScrollTop] = useState(0)
  const [listViewportHeight, setListViewportHeight] = useState(0)
  const resultContentRef = useRef<HTMLDivElement>(null)
  const listViewportRef = useRef<HTMLDivElement>(null)

  const normalizedSearch = useMemo(() => normalizeSearchText(search), [search])
  const deferredSearch = useDeferredValue(normalizedSearch)
  const normalizedResultSearch = useMemo(() => resultSearch.trim().toLowerCase(), [resultSearch])
  const uniqueApiItems = useMemo(() => dedupeApiItems(apiItems), [apiItems])

  const loadApis = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await listLocalGameApis()
      const uniqueItems = dedupeApiItems(response.items)
      setApiItems(uniqueItems)
      setSelectedCmd((current) => {
        if (current && uniqueItems.some((item) => item.cmd === current)) {
          return current
        }
        return uniqueItems[0]?.cmd ?? ''
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      toast.error('\u52a0\u8f7d API \u5217\u8868\u5931\u8d25', { description: message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadApis()
  }, [])

  useEffect(() => {
    const viewport = listViewportRef.current
    if (!viewport) return

    const updateSize = () => {
      setListViewportHeight(viewport.clientHeight)
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const viewport = listViewportRef.current
    if (!viewport) return
    viewport.scrollTop = 0
    setListScrollTop(0)
  }, [deferredSearch])

  const filteredItems = useMemo(() => {
    if (!deferredSearch) {
      return uniqueApiItems
    }

    const tokens = deferredSearch.split(/\s+/).filter(Boolean)
    const compactTokens = tokens.map((token) => compactSearchText(token))

    return uniqueApiItems
      .map((item) => {
        const index = buildApiSearchIndex(item)
        const matched = tokens.every((token, idx) => {
          const compactToken = compactTokens[idx]
          const nameMatched = index.shortName.includes(token) || (compactToken.length > 0 && index.shortNameCompact.includes(compactToken))
          const commentMatched = index.comment.includes(token) || (compactToken.length > 0 && index.commentCompact.includes(compactToken))
          return nameMatched || commentMatched
        })

        if (!matched) {
          return null
        }

        let score = 0
        if (index.shortName.startsWith(deferredSearch)) score += 8
        if (index.shortName.includes(deferredSearch)) score += 4
        if (index.comment.includes(deferredSearch)) score += 2
        return { item, score }
      })
      .filter((entry): entry is { item: LocalGameApiInfo; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score || a.item.cmd.localeCompare(b.item.cmd))
      .map((entry) => entry.item)
  }, [deferredSearch, uniqueApiItems])

  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedCmd('')
      return
    }
    if (!filteredItems.some((item) => item.cmd === selectedCmd)) {
      setSelectedCmd(filteredItems[0].cmd)
    }
  }, [filteredItems, selectedCmd])

  const selectedApi = useMemo(
    () => filteredItems.find((item) => item.cmd === selectedCmd) ?? null,
    [filteredItems, selectedCmd]
  )

  const paramEntries = useMemo(() => sortParamEntries(selectedApi?.params ?? null), [selectedApi])

  useEffect(() => {
    setParamValues((current) => {
      const next: Record<string, string> = {}
      for (const [name] of paramEntries) {
        next[name] = current[name] ?? ''
      }
      return next
    })
  }, [paramEntries])

  const totalListHeight = filteredItems.length * API_ROW_HEIGHT
  const visibleStartIndex = Math.max(Math.floor(listScrollTop / API_ROW_HEIGHT) - API_LIST_OVERSCAN, 0)
  const visibleCount = Math.max(Math.ceil(listViewportHeight / API_ROW_HEIGHT) + API_LIST_OVERSCAN * 2, API_LIST_OVERSCAN * 2)
  const visibleEndIndex = Math.min(visibleStartIndex + visibleCount, filteredItems.length)
  const visibleItems = filteredItems.slice(visibleStartIndex, visibleEndIndex)

  const formattedResult = useMemo(() => formatResultText(result), [result])
  const resultLineCount = useMemo(() => (formattedResult ? formattedResult.split('\n').length : 0), [formattedResult])
  const hasResultSearch = normalizedResultSearch.length > 0
  const resultMatchLabel = hasResultSearch
    ? totalResultMatches > 0
      ? `${activeResultMatchIndex + 1}/${totalResultMatches}`
      : '0/0'
    : '0/0'

  useEffect(() => {
    if (!hasResultSearch) {
      setTotalResultMatches(0)
      setActiveResultMatchIndex(0)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const hits = getSearchHits(resultContentRef.current)
      setTotalResultMatches(hits.length)
      setActiveResultMatchIndex((current) => {
        if (hits.length === 0) return 0
        return current >= hits.length ? 0 : current
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [formattedResult, hasResultSearch])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const hits = getSearchHits(resultContentRef.current)
      hits.forEach((hit, index) => {
        if (hasResultSearch && index === activeResultMatchIndex) {
          hit.dataset.activeSearchHit = 'true'
        } else {
          delete hit.dataset.activeSearchHit
        }
      })

      if (!hasResultSearch || hits.length === 0) return
      const target = hits[activeResultMatchIndex] ?? hits[0]
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeResultMatchIndex, formattedResult, hasResultSearch])

  const jumpToResultMatch = useCallback((direction: 1 | -1) => {
    if (totalResultMatches === 0) return
    setActiveResultMatchIndex((current) => {
      const next = current + direction
      if (next < 0) return totalResultMatches - 1
      if (next >= totalResultMatches) return 0
      return next
    })
  }, [totalResultMatches])

  const handleResultSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    jumpToResultMatch(event.shiftKey ? -1 : 1)
  }, [jumpToResultMatch])

  const handleExecute = async () => {
    if (!selectedApi) {
      return
    }

    const params = Object.fromEntries(paramEntries.map(([name]) => [name, paramValues[name] ?? '']))
    setExecuting(true)
    try {
      const response = await executeLocalGameApi(selectedApi.cmd, params)
      setResult(response)
      setActiveResultMatchIndex(0)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('\u6267\u884c API \u5931\u8d25', { description: message })
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/20">
      <div className="border-b border-border bg-background px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Blocks className="size-4 text-primary" />
              {'\u672c\u5730 API \u8c03\u7528'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {'\u641c\u7d22\u53ea\u5339\u914d API \u540d\uff08\u70b9\u53f7\u540e\u7684\u90e8\u5206\uff09\u548c\u4e2d\u6587\u63cf\u8ff0\u3002'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{uniqueApiItems.length} API</Badge>
            <Button variant="outline" size="sm" onClick={() => void loadApis()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {'\u5237\u65b0'}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="border-b border-border px-4 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={'\u641c\u7d22 API \u540d\uff08\u4ec5\u5339\u914d\u70b9\u53f7\u540e\u90e8\u5206\uff09\u6216\u4e2d\u6587\u63cf\u8ff0'}
                className="h-10 border-border bg-background pl-9 pr-9"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{'\u53ef\u7528 API \u5217\u8868'}</span>
              <span>{filteredItems.length} / {uniqueApiItems.length}</span>
            </div>
          </div>

          <div ref={listViewportRef} className="min-h-0 flex-1 overflow-y-auto p-3" onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}>
            {filteredItems.length > 0 ? (
              <div style={{ height: totalListHeight, position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: visibleStartIndex * API_ROW_HEIGHT,
                    left: 0,
                    right: 0,
                  }}
                  className="space-y-2"
                >
                  {visibleItems.map((item) => {
                    const selected = item.cmd === selectedCmd
                    const paramCount = Object.keys(item.params ?? {}).length
                    const { namespace, shortName } = splitApiCommand(item.cmd)

                    return (
                      <button
                        key={item.cmd}
                        type="button"
                        onClick={() => setSelectedCmd(item.cmd)}
                        className={cn(
                          'h-[84px] w-full rounded-lg border px-3 py-3 text-left transition-colors',
                          selected
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-background hover:border-primary/40 hover:bg-accent/50'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-semibold text-foreground">
                                {renderHighlightedText(shortName, deferredSearch)}
                              </div>
                              {namespace ? (
                                <span className="shrink-0 text-[11px] text-muted-foreground">{namespace}</span>
                              ) : null}
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {renderHighlightedText(item.comment || '\u65e0\u63cf\u8ff0', deferredSearch)}
                            </div>
                          </div>
                          <Badge variant={selected ? 'default' : 'secondary'} className="shrink-0">
                            {paramCount}
                          </Badge>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {!loading && filteredItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {loadError || '\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684 API'}
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid min-h-0 gap-4 grid-rows-[auto_minmax(0,1fr)]">
          <div className="rounded-xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-foreground">
                    {selectedApi?.cmd || '\u8bf7\u4ece\u5de6\u4fa7\u9009\u62e9 API'}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {selectedApi?.comment || '\u9009\u62e9 API \u540e\uff0c\u5728\u8fd9\u91cc\u586b\u53c2\u6570\u5e76\u6267\u884c\u3002'}
                  </div>
                </div>
                {selectedApi ? (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{selectedApi.classDeclaring || '\u672a\u5206\u7c7b'}</Badge>
                    <Badge variant="secondary">{selectedApi.returnType || 'String'}</Badge>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              {paramEntries.length > 0 ? paramEntries.map(([name, type]) => (
                <div key={name} className="grid gap-2 xl:grid-cols-[170px_minmax(0,360px)] xl:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{type || 'string'}</div>
                  </div>
                  <Input
                    value={paramValues[name] ?? ''}
                    onChange={(event) => setParamValues((current) => ({ ...current, [name]: event.target.value }))}
                    placeholder={'\u8f93\u5165\u53c2\u6570\u503c'}
                    className="h-9 w-full max-w-[360px] border-border bg-background"
                  />
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                  {selectedApi ? '\u8fd9\u4e2a API \u6ca1\u6709\u53c2\u6570\u3002' : '\u5148\u9009\u62e9\u4e00\u4e2a API\u3002'}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-border px-4 py-3">
              <Button onClick={() => void handleExecute()} disabled={!selectedApi || executing} className="min-w-28">
                {executing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {'\u6267\u884c'}
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3 text-[11px]">
              <div>
                <div className="text-sm font-semibold text-foreground">{'\u8fd4\u56de\u5185\u5bb9'}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {result
                    ? `HTTP ${result.statusCode} | ${resultLineCount} \u884c`
                    : '\u6267\u884c API \u540e\u5728\u8fd9\u91cc\u67e5\u770b\u7ed3\u679c'}
                </div>
              </div>
              <div className="relative min-w-[220px] flex-1 sm:ml-auto sm:max-w-[66%]">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={resultSearch}
                  onChange={(event) => setResultSearch(event.target.value)}
                  onKeyDown={handleResultSearchKeyDown}
                  placeholder={'\u641c\u7d22\u8fd4\u56de\u5185\u5bb9'}
                  className="h-8 border-border bg-background pl-7 pr-7 text-[11px]"
                />
                {resultSearch ? (
                  <button
                    type="button"
                    onClick={() => setResultSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    title="Clear search"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                <span>{resultMatchLabel}</span>
                <button
                  type="button"
                  onClick={() => jumpToResultMatch(-1)}
                  disabled={totalResultMatches === 0}
                  className="inline-flex items-center rounded border border-border/60 p-1 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title="Previous match"
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => jumpToResultMatch(1)}
                  disabled={totalResultMatches === 0}
                  className="inline-flex items-center rounded border border-border/60 p-1 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  title="Next match"
                >
                  <ChevronDown className="size-3" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              <div ref={resultContentRef} className="p-4">
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/35 p-4 text-xs leading-6 text-foreground">
                  {formattedResult
                    ? highlightResultText(formattedResult, normalizedResultSearch)
                    : '\u6682\u65e0\u7ed3\u679c'}
                </pre>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}