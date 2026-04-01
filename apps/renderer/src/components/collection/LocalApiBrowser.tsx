import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Blocks, Loader2, Play, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { executeLocalGameApi, listLocalGameApis, type LocalGameApiExecuteResult, type LocalGameApiInfo } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function sortParamEntries(params: Record<string, string> | null) {
  return Object.entries(params ?? {}).sort((a, b) => a[0].localeCompare(b[0]))
}

function normalizeSearchText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/[\s_./:-]+/g, '')
}

function buildApiSearchIndex(item: LocalGameApiInfo) {
  const paramText = Object.entries(item.params ?? {})
    .map(([name, type]) => `${name} ${type}`)
    .join(' ')

  const fullText = [
    item.cmd,
    item.comment,
    item.classDeclaring,
    item.returnType,
    paramText,
  ].filter(Boolean).join(' ')

  return {
    normalized: normalizeSearchText(fullText),
    compact: compactSearchText(fullText),
  }
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

function countMatches(text: string, query: string) {
  const keyword = query.trim()
  if (!text || !keyword) {
    return 0
  }

  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'giu')
  return text.match(regex)?.length ?? 0
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

  const deferredSearch = useDeferredValue(search)
  const deferredResultSearch = useDeferredValue(resultSearch)

  const loadApis = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await listLocalGameApis()
      setApiItems(response.items)
      setSelectedCmd((current) => {
        if (current && response.items.some((item) => item.cmd === current)) {
          return current
        }
        return response.items[0]?.cmd ?? ''
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

  const filteredItems = useMemo(() => {
    const normalizedSearch = normalizeSearchText(deferredSearch)
    if (!normalizedSearch) {
      return apiItems
    }

    const tokens = normalizedSearch.split(/\s+/).filter(Boolean)
    const compactQuery = compactSearchText(deferredSearch)

    return apiItems
      .map((item) => {
        const index = buildApiSearchIndex(item)
        const matched = tokens.every((token) => index.normalized.includes(token) || index.compact.includes(compactSearchText(token)))
        if (!matched) {
          return null
        }

        let score = 0
        const normalizedCmd = normalizeSearchText(item.cmd)
        const normalizedComment = normalizeSearchText(item.comment)
        if (normalizedCmd.startsWith(normalizedSearch)) score += 6
        if (normalizedCmd.includes(normalizedSearch)) score += 4
        if (normalizedComment.includes(normalizedSearch)) score += 3
        if (compactQuery && compactSearchText(item.cmd).includes(compactQuery)) score += 2
        if (compactQuery && compactSearchText(item.comment).includes(compactQuery)) score += 1

        return { item, score }
      })
      .filter((entry): entry is { item: LocalGameApiInfo; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score || a.item.cmd.localeCompare(b.item.cmd))
      .map((entry) => entry.item)
  }, [apiItems, deferredSearch])

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
    () => apiItems.find((item) => item.cmd === selectedCmd) ?? null,
    [apiItems, selectedCmd]
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

  const formattedResult = useMemo(() => formatResultText(result), [result])
  const resultLineCount = useMemo(() => (formattedResult ? formattedResult.split('\n').length : 0), [formattedResult])
  const resultMatchCount = useMemo(() => countMatches(formattedResult, deferredResultSearch), [formattedResult, deferredResultSearch])

  const handleExecute = async () => {
    if (!selectedApi) {
      return
    }

    const params = Object.fromEntries(paramEntries.map(([name]) => [name, paramValues[name] ?? '']))
    setExecuting(true)
    try {
      const response = await executeLocalGameApi(selectedApi.cmd, params)
      setResult(response)
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
              {'\u4ec5\u5728 127.0.0.1 \u8fde\u63a5\u4e0b\u53ef\u7528\uff0c\u4f7f\u7528 listApi \u62c9\u53d6\u5217\u8868\uff0c\u6267\u884c\u65b9\u5f0f\u4e0e api_call.py \u4fdd\u6301\u4e00\u81f4\u3002'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{apiItems.length} API</Badge>
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
                placeholder={'\u641c\u7d22 API\u3001\u4e2d\u6587\u63cf\u8ff0\u3001\u53c2\u6570\u540d'}
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
              <span>{filteredItems.length} / {apiItems.length}</span>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {filteredItems.map((item) => {
                const selected = item.cmd === selectedCmd
                const paramCount = Object.keys(item.params ?? {}).length
                return (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => setSelectedCmd(item.cmd)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-background hover:border-primary/40 hover:bg-accent/50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {renderHighlightedText(item.cmd, deferredSearch)}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {renderHighlightedText(item.comment || item.classDeclaring || '\u65e0\u63cf\u8ff0', deferredSearch)}
                        </div>
                      </div>
                      <Badge variant={selected ? 'default' : 'secondary'} className="shrink-0">
                        {paramCount}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      <Badge variant="outline" className="max-w-full truncate">{item.classDeclaring || '\u672a\u5206\u7c7b'}</Badge>
                      <Badge variant="outline" className="max-w-full truncate">{item.returnType || 'String'}</Badge>
                    </div>
                  </button>
                )
              })}

              {!loading && filteredItems.length === 0 && (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {loadError || '\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684 API'}
                </div>
              )}
            </div>
          </ScrollArea>
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-foreground">{'\u8fd4\u56de\u5185\u5bb9'}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {result
                    ? `HTTP ${result.statusCode} | ${resultLineCount} \u884c${deferredResultSearch ? ` | ${resultMatchCount} \u5904\u5339\u914d` : ''}`
                    : '\u6267\u884c API \u540e\u5728\u8fd9\u91cc\u67e5\u770b\u7ed3\u679c'}
                </div>
              </div>
              <div className="relative w-full max-w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={resultSearch}
                  onChange={(event) => setResultSearch(event.target.value)}
                  placeholder={'\u641c\u7d22\u8fd4\u56de\u5185\u5bb9'}
                  className="h-9 border-border bg-background pl-9 pr-9"
                />
                {resultSearch ? (
                  <button
                    type="button"
                    onClick={() => setResultSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4">
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/35 p-4 text-xs leading-6 text-foreground">
                  {formattedResult
                    ? renderHighlightedText(formattedResult, deferredResultSearch)
                    : '\u6682\u65e0\u7ed3\u679c'}
                </pre>
              </div>
            </ScrollArea>
          </div>
        </section>
      </div>
    </div>
  )
}
