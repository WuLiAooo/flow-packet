import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  Check,
  ChevronsUpDown,
  FileCode2,
  FileSpreadsheet,
  FolderTree,
  Loader2,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  TableProperties,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  listConfigDocumentRows,
  listConfigGroupFiles,
  openConfigDocument,
  saveConfigDocument,
  scanConfigRoot,
  type ConfigFileEntry,
  type ConfigGroupSummary,
  type ConfigTableDocument,
  type ConfigTableSearch,
} from '@/services/configTable'
import {
  CONFIG_TABLE_ALL_COLUMNS,
  DEFAULT_CONFIG_TABLE_PAGE_SIZE,
  appendConfigRowsPage,
  buildConfigSaveRequest,
  buildConfigTableStats,
  buildVisibleColumns,
  computeConfigVirtualWindow,
  decidePendingNavigation,
  filterConfigFiles,
  getConfigRowIDValue,
  hasEditedRows,
  mergeConfigRows,
  type PendingNavigationTarget,
} from './configTableDocument.js'
import { UnsavedConfigDialog } from './UnsavedConfigDialog'

const DEFAULT_ROOT = 'C:\\top-hero\\Meta'
const TOAST_IDS = {
  groups: 'config-groups-load-error',
  files: 'config-files-load-error',
  open: 'config-document-open-error',
  rows: 'config-document-rows-error',
  save: 'config-document-save-error',
} as const

const sourceTypeLabels: Record<ConfigFileEntry['sourceType'], string> = {
  xml: 'XML',
  xlsx: 'XLSX',
}
const CONFIG_TABLE_ROW_HEIGHT = 48
const CONFIG_TABLE_ROW_OVERSCAN = 8

type PendingNavigation = PendingNavigationTarget

type ConfigSearchForm = {
  column: string
  value: string
  exact: boolean
}

function getFileIcon(sourceType: ConfigFileEntry['sourceType']) {
  return sourceType === 'xml' ? FileCode2 : FileSpreadsheet
}

function createDefaultSearchForm(): ConfigSearchForm {
  return { column: CONFIG_TABLE_ALL_COLUMNS, value: '', exact: false }
}

function mapSearchToForm(search?: ConfigTableSearch): ConfigSearchForm {
  return {
    column: search?.column ? search.column : CONFIG_TABLE_ALL_COLUMNS,
    value: search?.value ?? '',
    exact: Boolean(search?.exact),
  }
}

function mapFormToSearch(form: ConfigSearchForm): ConfigTableSearch {
  const value = form.value.trim()
  if (!value) {
    return { column: '', value: '', exact: false }
  }
  return {
    column: form.column === CONFIG_TABLE_ALL_COLUMNS ? '' : form.column,
    value,
    exact: form.exact,
  }
}

function areRowValuesEqual(left: Record<string, string>, right: Record<string, string>, columns: string[]) {
  return columns.every((column) => (left[column] ?? '') === (right[column] ?? ''))
}

export function ConfigTablePage() {
  const [rootPathInput, setRootPathInput] = useState(DEFAULT_ROOT)
  const [loadedRootPath, setLoadedRootPath] = useState(DEFAULT_ROOT)
  const [groups, setGroups] = useState<ConfigGroupSummary[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [files, setFiles] = useState<ConfigFileEntry[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [fileSearch, setFileSearch] = useState('')
  const [activeFileType, setActiveFileType] = useState<ConfigFileEntry['sourceType']>('xml')
  const [document, setDocument] = useState<ConfigTableDocument | null>(null)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [editedRows, setEditedRows] = useState<Map<number, Record<string, string>>>(new Map())
  const [searchForm, setSearchForm] = useState<ConfigSearchForm>(createDefaultSearchForm())
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [openingDocument, setOpeningDocument] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [savingDocument, setSavingDocument] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false)
  const [columnSheetOpen, setColumnSheetOpen] = useState(false)
  const [searchColumnOpen, setSearchColumnOpen] = useState(false)
  const [tableScrollTop, setTableScrollTop] = useState(0)
  const [tableViewportHeight, setTableViewportHeight] = useState(0)
  const didInitRef = useRef(false)
  const tableScrollRef = useRef<HTMLDivElement | null>(null)

  const deferredFileSearch = useDeferredValue(fileSearch)
  const filteredFiles = useMemo(() => filterConfigFiles(files, activeFileType, deferredFileSearch), [activeFileType, deferredFileSearch, files])
  const activeTypeFileCount = useMemo(() => files.filter((file) => file.sourceType === activeFileType).length, [activeFileType, files])
  const visibleColumns = useMemo(() => buildVisibleColumns(document?.columns ?? [], hiddenColumns), [document?.columns, hiddenColumns])
  const showStickyIDColumn = visibleColumns.includes('id')
  const dataColumns = useMemo(() => (showStickyIDColumn ? visibleColumns.filter((column) => column !== 'id') : visibleColumns), [showStickyIDColumn, visibleColumns])
  const tableColumnCount = dataColumns.length + (showStickyIDColumn ? 1 : 0)
  const selectedFile = useMemo(() => files.find((file) => file.filePath === selectedFilePath) ?? null, [files, selectedFilePath])
  const displayedRows = useMemo(() => mergeConfigRows(document?.rows ?? [], editedRows), [document?.rows, editedRows])
  const displayedRowLookup = useMemo(() => new Map(displayedRows.map((row) => [row.rowIndex, row.values])), [displayedRows])
  const sourceRowLookup = useMemo(() => new Map((document?.rows ?? []).map((row) => [row.rowIndex, row.values])), [document?.rows])
  const effectiveTableViewportHeight = tableViewportHeight > 0 ? tableViewportHeight : CONFIG_TABLE_ROW_HEIGHT * 8
  const virtualWindow = useMemo(() => computeConfigVirtualWindow({
    rowCount: displayedRows.length,
    scrollTop: tableScrollTop,
    viewportHeight: effectiveTableViewportHeight,
    rowHeight: CONFIG_TABLE_ROW_HEIGHT,
    overscan: CONFIG_TABLE_ROW_OVERSCAN,
  }), [displayedRows.length, effectiveTableViewportHeight, tableScrollTop])
  const virtualRows = useMemo(
    () => (
      virtualWindow.endIndex >= virtualWindow.startIndex
        ? displayedRows.slice(virtualWindow.startIndex, virtualWindow.endIndex + 1)
        : []
    ),
    [displayedRows, virtualWindow.endIndex, virtualWindow.startIndex],
  )
  const isDirty = hasEditedRows(editedRows)
  const headerStats = useMemo(() => buildConfigTableStats(document, visibleColumns.length, isDirty), [document, visibleColumns.length, isDirty])
  const canLoadMoreRows = Boolean(document && document.rows.length < document.totalRows)
  const selectedSearchColumnLabel = searchForm.column === CONFIG_TABLE_ALL_COLUMNS ? '全部列' : searchForm.column
  const canResetSearch = searchForm.column !== CONFIG_TABLE_ALL_COLUMNS || searchForm.value !== '' || searchForm.exact

  useEffect(() => {
    if (didInitRef.current) {
      return
    }
    didInitRef.current = true
    void switchRoot(DEFAULT_ROOT)
  }, [])

  const resetTableScrollPosition = () => {
    setTableScrollTop(0)
    const target = tableScrollRef.current
    if (target) {
      target.scrollTop = 0
    }
  }

  const resetDocument = () => {
    setSelectedFilePath('')
    setDocument(null)
    setHiddenColumns(new Set())
    setEditedRows(new Map())
    setSearchForm(createDefaultSearchForm())
    setColumnSheetOpen(false)
    setSearchColumnOpen(false)
    setActiveFileType('xml')
    resetTableScrollPosition()
  }

  const applyDocument = (filePath: string, nextDocument: ConfigTableDocument) => {
    resetTableScrollPosition()
    startTransition(() => {
      setSelectedFilePath(filePath)
      setDocument(nextDocument)
      setHiddenColumns(new Set())
      setEditedRows(new Map())
      setSearchForm(mapSearchToForm(nextDocument.search))
      setSearchColumnOpen(false)
    })
  }

  const applyRowsPage = (rowsPage: {
    rows: ConfigTableDocument['rows']
    totalRows: number
    offset: number
    limit: number
    search?: ConfigTableSearch
  }, append = false) => {
    if (!append) {
      resetTableScrollPosition()
    }
    startTransition(() => {
      setDocument((current) => current ? {
        ...current,
        rows: append ? appendConfigRowsPage(current.rows, rowsPage.rows) : rowsPage.rows,
        totalRows: rowsPage.totalRows,
        offset: append ? 0 : rowsPage.offset,
        limit: rowsPage.limit,
        search: rowsPage.search ?? current.search,
      } : current)
      setSearchForm(mapSearchToForm(rowsPage.search))
    })
  }

  const switchRoot = async (nextRootPath: string) => {
    const normalizedRootPath = nextRootPath.trim() || DEFAULT_ROOT
    setLoadingGroups(true)
    try {
      const groupResponse = await scanConfigRoot(normalizedRootPath)
      const nextGroups = groupResponse.groups
      const nextGroup = nextGroups[0]?.groupKey ?? ''
      let nextFiles: ConfigFileEntry[] = []
      if (nextGroup) {
        try {
          nextFiles = (await listConfigGroupFiles(normalizedRootPath, nextGroup)).files
        } catch {
          toast.error('加载文件列表失败', { id: TOAST_IDS.files })
        }
      }
      startTransition(() => {
        setLoadedRootPath(normalizedRootPath)
        setRootPathInput(normalizedRootPath)
        setGroups(nextGroups)
        setSelectedGroup(nextGroup)
        setFiles(nextFiles)
        setFileSearch('')
        resetDocument()
      })
    } catch {
      toast.error('加载配置组失败', { id: TOAST_IDS.groups })
    } finally {
      setLoadingGroups(false)
    }
  }

  const switchGroup = async (groupKey: string) => {
    if (!groupKey || groupKey === selectedGroup) {
      return
    }
    setLoadingFiles(true)
    try {
      const response = await listConfigGroupFiles(loadedRootPath, groupKey)
      startTransition(() => {
        setSelectedGroup(groupKey)
        setFiles(response.files)
        setFileSearch('')
        resetDocument()
      })
    } catch {
      toast.error('加载文件列表失败', { id: TOAST_IDS.files })
    } finally {
      setLoadingFiles(false)
    }
  }

  const openFile = async (filePath: string, sheetName = '') => {
    if (!filePath) {
      return
    }
    setOpeningDocument(true)
    try {
      const nextDocument = await openConfigDocument(filePath, sheetName, {
        offset: 0,
        limit: DEFAULT_CONFIG_TABLE_PAGE_SIZE,
        search: { column: '', value: '', exact: false },
      })
      applyDocument(filePath, nextDocument)
    } catch {
      toast.error('打开文件失败', { id: TOAST_IDS.open })
    } finally {
      setOpeningDocument(false)
    }
  }

  const loadRowsPage = async (options: { offset?: number; search?: ConfigTableSearch; append?: boolean } = {}) => {
    if (!document) {
      return
    }
    setLoadingRows(true)
    try {
      const page = await listConfigDocumentRows(document.filePath, document.sheetName, {
        offset: options.offset ?? (options.append ? document.rows.length : 0),
        limit: document.limit || DEFAULT_CONFIG_TABLE_PAGE_SIZE,
        search: options.search ?? document.search,
      })
      applyRowsPage(page, options.append === true)
    } catch {
      toast.error('加载表格数据失败', { id: TOAST_IDS.rows })
    } finally {
      setLoadingRows(false)
    }
  }

  const persistDocument = async () => {
    if (!document) {
      return false
    }
    if (!isDirty) {
      return true
    }
    setSavingDocument(true)
    try {
      const request = buildConfigSaveRequest(document, editedRows)
      await saveConfigDocument(request)
      setEditedRows(new Map())
      toast.success('保存成功')
      return true
    } catch {
      toast.error('保存失败', { id: TOAST_IDS.save })
      return false
    } finally {
      setSavingDocument(false)
    }
  }

  const runPendingNavigation = async (target: PendingNavigation) => {
    if (target.type === 'root') {
      await switchRoot(target.value)
      return
    }
    if (target.type === 'group') {
      await switchGroup(target.value)
      return
    }
    if (target.type === 'file') {
      await openFile(target.value)
      return
    }
    if (target.type === 'sheet') {
      await openFile(selectedFilePath, target.value)
    }
  }

  const requestNavigation = (target: PendingNavigation) => {
    const decision = decidePendingNavigation(isDirty, target)
    if (decision.allow) {
      void runPendingNavigation(target)
      return
    }
    setPendingNavigation(decision.pending)
    setUnsavedDialogOpen(true)
  }

  const handleRootSubmit = () => {
    requestNavigation({ type: 'root', value: rootPathInput })
  }

  const handleRootKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    handleRootSubmit()
  }

  const handleGroupChange = (groupKey: string) => {
    requestNavigation({ type: 'group', value: groupKey })
  }

  const handleFileOpen = (filePath: string) => {
    requestNavigation({ type: 'file', value: filePath })
  }

  const handleSheetChange = (sheetName: string) => {
    requestNavigation({ type: 'sheet', value: sheetName })
  }

  const handleCancelPendingNavigation = () => {
    setUnsavedDialogOpen(false)
    setPendingNavigation(null)
  }

  const handleDiscardAndSwitch = () => {
    const nextTarget = pendingNavigation
    setUnsavedDialogOpen(false)
    setPendingNavigation(null)
    setEditedRows(new Map())
    if (nextTarget) {
      void runPendingNavigation(nextTarget)
    }
  }

  const handleSaveAndSwitch = async () => {
    if (!pendingNavigation) {
      return
    }
    const saved = await persistDocument()
    if (!saved) {
      return
    }
    const nextTarget = pendingNavigation
    setUnsavedDialogOpen(false)
    setPendingNavigation(null)
    await runPendingNavigation(nextTarget)
  }

  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    setEditedRows((current) => {
      const next = new Map(current)
      const baseValues = current.get(rowIndex) ?? displayedRowLookup.get(rowIndex)
      if (!baseValues) {
        return current
      }
      const nextValues = { ...baseValues, [column]: value }
      const sourceValues = sourceRowLookup.get(rowIndex)
      if (sourceValues && areRowValuesEqual(nextValues, sourceValues, document?.columns ?? [])) {
        next.delete(rowIndex)
      } else {
        next.set(rowIndex, nextValues)
      }
      return next
    })
  }

  const toggleColumnVisibility = (column: string, visible: boolean) => {
    setHiddenColumns((current) => {
      const next = new Set(current)
      if (visible) {
        next.delete(column)
      } else {
        next.add(column)
      }
      return next
    })
  }

  const handleSearchSubmit = () => {
    if (!document) {
      return
    }
    void loadRowsPage({ offset: 0, search: mapFormToSearch(searchForm) })
  }

  const handleSearchReset = () => {
    if (!document) {
      return
    }
    const nextForm = createDefaultSearchForm()
    setSearchForm(nextForm)
    void loadRowsPage({ offset: 0, search: mapFormToSearch(nextForm) })
  }

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    handleSearchSubmit()
  }

  const maybeLoadMoreRows = (target: HTMLDivElement) => {
    if (!document || loadingRows || openingDocument || !canLoadMoreRows) {
      return
    }
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
    if (remaining <= 120) {
      void loadRowsPage({ append: true, offset: document.rows.length })
    }
  }

  useEffect(() => {
    const target = tableScrollRef.current
    if (!target) {
      return
    }
    maybeLoadMoreRows(target)
  }, [document?.rows.length, document?.totalRows, loadingRows, openingDocument])

  useEffect(() => {
    const target = tableScrollRef.current
    if (!target) {
      return
    }

    const updateViewport = () => setTableViewportHeight(target.clientHeight)
    updateViewport()

    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(target)

    return () => {
      resizeObserver.disconnect()
    }
  }, [document?.filePath, document?.sheetName])

  return (
    <>
      <div className="grid h-full min-h-0 gap-4 bg-muted/20 p-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="border-b border-border px-4 py-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FolderTree className="size-4 text-primary" />
              配置表目录
            </div>
            <div className="mt-3 flex gap-2">
              <Input value={rootPathInput} onChange={(event) => setRootPathInput(event.target.value)} onKeyDown={handleRootKeyDown} placeholder={DEFAULT_ROOT} className="h-9" />
              <Button variant="outline" size="sm" onClick={handleRootSubmit} disabled={loadingGroups}>
                {loadingGroups ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                加载
              </Button>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">当前目录：{loadedRootPath}</div>
          </div>

          <div className="border-b border-border px-4 py-4">
            <div className="space-y-2">
              <Label>配置组</Label>
              <Select value={selectedGroup || undefined} onValueChange={handleGroupChange} disabled={loadingGroups || groups.length === 0}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={groups.length === 0 ? '暂无配置组' : '选择配置组'} />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.groupKey} value={group.groupKey}>{group.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-b border-border px-4 py-3">
            <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
              <button type="button" onClick={() => setActiveFileType('xml')} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', activeFileType === 'xml' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>XML</button>
              <button type="button" onClick={() => setActiveFileType('xlsx')} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', activeFileType === 'xlsx' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>XLSX</button>
            </div>
          </div>

          <div className="border-b border-border px-4 py-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} placeholder={activeFileType === 'xml' ? '搜索 XML 文件' : '搜索 XLSX 文件'} className="h-9 pl-9" disabled={activeTypeFileCount === 0 && !loadingFiles} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{activeFileType === 'xml' ? 'XML 列表' : 'XLSX 列表'}</span>
              <span>{filteredFiles.length} / {activeTypeFileCount}</span>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {loadingFiles ? (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />加载文件列表中
                </div>
              ) : filteredFiles.length > 0 ? filteredFiles.map((file) => {
                const FileIcon = getFileIcon(file.sourceType)
                const active = file.filePath === selectedFilePath
                return (
                  <button key={file.id} type="button" onClick={() => handleFileOpen(file.filePath)} className={cn('flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors', active ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-primary/40 hover:bg-accent/50')}>
                    <FileIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{file.fileName}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">{sourceTypeLabels[file.sourceType]}</Badge>
                        <span className="truncate">{file.groupKey}</span>
                      </div>
                    </div>
                  </button>
                )
              }) : (
                <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {selectedGroup ? `当前${activeFileType.toUpperCase()}列表没有匹配文件` : '请先选择配置组'}
                </div>
              )}
            </div>
          </ScrollArea>
        </section>

        <section className="grid min-h-0 gap-4 grid-rows-[auto_minmax(0,1fr)]">
          <div className="rounded-xl border border-border bg-background shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><TableProperties className="size-4 text-primary" />配置表编辑器</div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">{selectedFile ? `当前文件：${selectedFile.fileName}` : '从左侧选择一个 XML 或 XLSX 文件开始查看和编辑'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedFile ? <Badge variant="secondary">{sourceTypeLabels[selectedFile.sourceType]}</Badge> : null}
                {document?.sourceType === 'xlsx' && document.sheetNames && document.sheetNames.length > 0 ? (
                  <Select value={document.sheetName} onValueChange={handleSheetChange}>
                    <SelectTrigger size="sm" className="min-w-32"><SelectValue placeholder="选择 Sheet" /></SelectTrigger>
                    <SelectContent>{document.sheetNames.map((sheetName) => <SelectItem key={sheetName} value={sheetName}>{sheetName}</SelectItem>)}</SelectContent>
                  </Select>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => setColumnSheetOpen(true)} disabled={!document}><SlidersHorizontal className="size-4" />列显示</Button>
                <Button size="sm" onClick={() => void persistDocument()} disabled={!document || !isDirty || savingDocument || openingDocument}>
                  {savingDocument ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}保存
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-2.5">
              {headerStats.map((item) => (
                <div key={item.label} className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground">
                  <span>{item.label}</span><span className="font-medium text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-5 py-3">
              <div className="text-sm font-semibold text-foreground">表格数据</div>
              <div className="mt-1 text-xs text-muted-foreground">大文件按页加载；搜索由本地服务执行；保存仅回写已修改行。</div>
            </div>

            <div className="border-b border-border px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <Popover open={searchColumnOpen} onOpenChange={setSearchColumnOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" role="combobox" aria-expanded={searchColumnOpen} className="min-w-36 justify-between font-normal" disabled={!document}>
                        <span className="truncate">{selectedSearchColumnLabel}</span>
                        <ChevronsUpDown className="size-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    {document ? (
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="搜索列名" />
                          <CommandList>
                            <CommandEmpty>没有匹配列名</CommandEmpty>
                            <CommandGroup>
                              <CommandItem value="全部列" onSelect={() => { setSearchForm((current) => ({ ...current, column: CONFIG_TABLE_ALL_COLUMNS })); setSearchColumnOpen(false) }}>
                                <Check className={cn('mr-2 size-4', searchForm.column === CONFIG_TABLE_ALL_COLUMNS ? 'opacity-100' : 'opacity-0')} />全部列
                              </CommandItem>
                              {document.columns.map((column) => (
                                <CommandItem key={column} value={column} onSelect={() => { setSearchForm((current) => ({ ...current, column })); setSearchColumnOpen(false) }}>
                                  <Check className={cn('mr-2 size-4', searchForm.column === column ? 'opacity-100' : 'opacity-0')} />{column}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    ) : null}
                  </Popover>

                  <Input value={searchForm.value} onChange={(event) => setSearchForm((current) => ({ ...current, value: event.target.value }))} onKeyDown={handleSearchKeyDown} placeholder="输入搜索内容" className="h-8 min-w-56 flex-1" disabled={!document} />

                  <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={searchForm.exact} disabled={!document} onCheckedChange={(checked) => setSearchForm((current) => ({ ...current, exact: checked === true }))} />完全匹配
                  </label>

                  <Button size="sm" onClick={handleSearchSubmit} disabled={!document || loadingRows || openingDocument}><Search className="size-4" />搜索</Button>
                  <Button variant="outline" size="sm" onClick={handleSearchReset} disabled={!document || !canResetSearch || loadingRows}>重置</Button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>已加载 {document?.rows.length ?? 0} / {document?.totalRows ?? 0} 条</span>
                  {loadingRows ? <Loader2 className="size-4 animate-spin" /> : null}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {openingDocument ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" />正在打开文件</div>
              ) : !document ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">请选择左侧文件以查看配置内容。</div>
              ) : visibleColumns.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">当前所有列都被隐藏了，请在“列显示”里至少勾选一列。</div>
              ) : (
                <div
                  ref={tableScrollRef}
                  onScroll={(event) => {
                    setTableScrollTop(event.currentTarget.scrollTop)
                    maybeLoadMoreRows(event.currentTarget)
                  }}
                  className="h-full overflow-auto"
                >
                  <div className="min-w-max p-4">
                    <table className="min-w-full w-max caption-bottom text-sm">
                      <TableHeader>
                        <TableRow>
                          {showStickyIDColumn ? <TableHead className="sticky top-0 left-0 z-50 w-24 min-w-24 border-r border-border bg-background/95 text-center shadow-[10px_0_18px_-12px_rgba(15,23,42,0.42),0_10px_18px_-14px_rgba(15,23,42,0.5)] backdrop-blur supports-[backdrop-filter]:bg-background/85">id</TableHead> : null}
                          {dataColumns.map((column) => <TableHead key={column} className="sticky top-0 z-30 min-w-40 bg-background/95 shadow-[0_10px_18px_-14px_rgba(15,23,42,0.48)] backdrop-blur supports-[backdrop-filter]:bg-background/85">{column}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayedRows.length > 0 ? (
                          <>
                            {virtualWindow.offsetTop > 0 ? (
                              <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
                                <TableCell colSpan={tableColumnCount} className="h-0 border-0 p-0" style={{ height: virtualWindow.offsetTop }} />
                              </TableRow>
                            ) : null}

                            {virtualRows.map((row) => (
                              <TableRow key={`${document.filePath}-${document.sheetName ?? 'xml'}-${row.rowIndex}`} style={{ height: CONFIG_TABLE_ROW_HEIGHT }}>
                                {showStickyIDColumn ? <TableCell className="sticky left-0 z-20 w-24 min-w-24 border-r border-border bg-background/98 text-center text-xs font-medium text-foreground shadow-[10px_0_18px_-12px_rgba(15,23,42,0.34)]">{getConfigRowIDValue(row)}</TableCell> : null}
                                {dataColumns.map((column) => (
                                  <TableCell key={`${row.rowIndex}-${column}`} className="min-w-40">
                                    <Input value={row.values[column] ?? ''} onChange={(event) => handleCellChange(row.rowIndex, column, event.target.value)} className="h-8 min-w-32 border-border/70 bg-background" />
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}

                            {virtualWindow.offsetBottom > 0 ? (
                              <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
                                <TableCell colSpan={tableColumnCount} className="h-0 border-0 p-0" style={{ height: virtualWindow.offsetBottom }} />
                              </TableRow>
                            ) : null}
                          </>
                        ) : (
                          <TableRow>
                            <TableCell colSpan={tableColumnCount} className="py-8 text-center text-sm text-muted-foreground">{searchForm.value.trim() ? '当前搜索没有匹配数据。' : '当前文件没有可展示的数据。'}</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </table>
                    <div className="pt-3 text-center text-xs text-muted-foreground">
                      {loadingRows
                        ? '正在加载更多数据...'
                        : canLoadMoreRows
                          ? '向下滚动继续加载'
                          : document.totalRows > 0
                            ? '已加载全部数据'
                            : ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <Sheet open={columnSheetOpen} onOpenChange={setColumnSheetOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-base"><SlidersHorizontal className="size-4 text-primary" />列显示控制</SheetTitle>
            <SheetDescription>默认全选。取消后只隐藏展示，不影响实际保存内容。</SheetDescription>
          </SheetHeader>
          <div className="border-b border-border px-5 py-3 text-xs text-muted-foreground">共 {document?.columns.length ?? 0} 列，当前显示 {visibleColumns.length} 列</div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-5 py-4">
              {document?.columns.length ? document.columns.map((column) => (
                <label key={column} className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm text-foreground">
                  <Checkbox checked={!hiddenColumns.has(column)} onCheckedChange={(checked) => toggleColumnVisibility(column, checked === true)} />
                  <span className="min-w-0 flex-1 break-all">{column}</span>
                </label>
              )) : <div className="px-1 py-2 text-sm text-muted-foreground">打开文件后可选择要展示的列。</div>}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <UnsavedConfigDialog open={unsavedDialogOpen} onCancel={handleCancelPendingNavigation} onDiscardAndSwitch={handleDiscardAndSwitch} onSaveAndSwitch={() => void handleSaveAndSwitch()} />
    </>
  )
}
