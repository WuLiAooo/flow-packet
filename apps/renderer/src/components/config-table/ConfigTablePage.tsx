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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  listConfigGroupFiles,
  openConfigDocument,
  saveConfigDocument,
  scanConfigRoot,
  type ConfigFileEntry,
  type ConfigGroupSummary,
  type ConfigTableDocument,
} from '@/services/configTable'
import {
  buildConfigTableStats,
  buildVisibleColumns,
  createDocumentSnapshot,
  decidePendingNavigation,
  filterConfigFiles,
  hasDocumentChanges,
  type PendingNavigationTarget,
} from './configTableDocument.js'
import { UnsavedConfigDialog } from './UnsavedConfigDialog'

const DEFAULT_ROOT = 'C:\\top-hero\\Meta'
const TOAST_IDS = {
  groups: 'config-groups-load-error',
  files: 'config-files-load-error',
  open: 'config-document-open-error',
  save: 'config-document-save-error',
} as const

const sourceTypeLabels: Record<ConfigFileEntry['sourceType'], string> = {
  xml: 'XML',
  xlsx: 'XLSX',
}

type PendingNavigation = PendingNavigationTarget

function getFileIcon(sourceType: ConfigFileEntry['sourceType']) {
  return sourceType === 'xml' ? FileCode2 : FileSpreadsheet
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
  const [snapshot, setSnapshot] = useState('')
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [openingDocument, setOpeningDocument] = useState(false)
  const [savingDocument, setSavingDocument] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false)
  const [columnSheetOpen, setColumnSheetOpen] = useState(false)
  const didInitRef = useRef(false)

  const deferredFileSearch = useDeferredValue(fileSearch)

  const filteredFiles = useMemo(
    () => filterConfigFiles(files, activeFileType, deferredFileSearch),
    [activeFileType, deferredFileSearch, files]
  )

  const activeTypeFileCount = useMemo(
    () => files.filter((file) => file.sourceType === activeFileType).length,
    [activeFileType, files]
  )

  const visibleColumns = useMemo(
    () => buildVisibleColumns(document?.columns ?? [], hiddenColumns),
    [document, hiddenColumns]
  )

  const selectedFile = useMemo(
    () => files.find((file) => file.filePath === selectedFilePath) ?? null,
    [files, selectedFilePath]
  )

  const isDirty = document ? hasDocumentChanges(snapshot, document) : false
  const headerStats = useMemo(
    () => buildConfigTableStats(document, visibleColumns.length, isDirty),
    [document, visibleColumns.length, isDirty]
  )

  useEffect(() => {
    if (didInitRef.current) {
      return
    }

    didInitRef.current = true
    void switchRoot(DEFAULT_ROOT)
  }, [])

  const resetDocument = () => {
    setSelectedFilePath('')
    setDocument(null)
    setHiddenColumns(new Set())
    setSnapshot('')
    setColumnSheetOpen(false)
    setActiveFileType('xml')
  }

  const applyDocument = (filePath: string, nextDocument: ConfigTableDocument) => {
    startTransition(() => {
      setSelectedFilePath(filePath)
      setDocument(nextDocument)
      setHiddenColumns(new Set())
      setSnapshot(createDocumentSnapshot(nextDocument))
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
      const nextDocument = await openConfigDocument(filePath, sheetName)
      applyDocument(filePath, nextDocument)
    } catch {
      toast.error('打开文件失败', { id: TOAST_IDS.open })
    } finally {
      setOpeningDocument(false)
    }
  }

  const persistDocument = async () => {
    if (!document) {
      return false
    }

    setSavingDocument(true)
    try {
      await saveConfigDocument(document)
      setSnapshot(createDocumentSnapshot(document))
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
    setDocument((current) => {
      if (!current) {
        return current
      }

      const nextRows = current.rows.map((row, index) => (
        index === rowIndex
          ? { ...row, [column]: value }
          : row
      ))

      return {
        ...current,
        rows: nextRows,
      }
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
              <Input
                value={rootPathInput}
                onChange={(event) => setRootPathInput(event.target.value)}
                onKeyDown={handleRootKeyDown}
                placeholder={DEFAULT_ROOT}
                className="h-9"
              />
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
                    <SelectItem key={group.groupKey} value={group.groupKey}>
                      {group.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-b border-border px-4 py-3">
            <div className="inline-flex rounded-lg border border-border bg-muted/20 p-1">
              <button
                type="button"
                onClick={() => setActiveFileType('xml')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  activeFileType === 'xml'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                XML
              </button>
              <button
                type="button"
                onClick={() => setActiveFileType('xlsx')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  activeFileType === 'xlsx'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                XLSX
              </button>
            </div>
          </div>

          <div className="border-b border-border px-4 py-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                placeholder={activeFileType === 'xml' ? '搜索 XML 文件' : '搜索 XLSX 文件'}
                className="h-9 pl-9"
                disabled={activeTypeFileCount === 0 && !loadingFiles}
              />
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
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  加载文件列表中
                </div>
              ) : filteredFiles.length > 0 ? (
                filteredFiles.map((file) => {
                  const FileIcon = getFileIcon(file.sourceType)
                  const active = file.filePath === selectedFilePath

                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => handleFileOpen(file.filePath)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                        active
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-background hover:border-primary/40 hover:bg-accent/50'
                      )}
                    >
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
                })
              ) : (
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
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <TableProperties className="size-4 text-primary" />
                  配置表编辑器
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {selectedFile
                    ? `当前文件：${selectedFile.fileName}`
                    : '从左侧选择一个 XML 或 XLSX 文件开始查看和编辑'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {selectedFile ? <Badge variant="secondary">{sourceTypeLabels[selectedFile.sourceType]}</Badge> : null}
                {document?.sourceType === 'xlsx' && document.sheetNames && document.sheetNames.length > 0 ? (
                  <Select value={document.sheetName} onValueChange={handleSheetChange}>
                    <SelectTrigger size="sm" className="min-w-32">
                      <SelectValue placeholder="选择 Sheet" />
                    </SelectTrigger>
                    <SelectContent>
                      {document.sheetNames.map((sheetName) => (
                        <SelectItem key={sheetName} value={sheetName}>
                          {sheetName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setColumnSheetOpen(true)}
                  disabled={!document}
                >
                  <SlidersHorizontal className="size-4" />
                  列显示
                </Button>
                <Button size="sm" onClick={() => void persistDocument()} disabled={!document || savingDocument || openingDocument}>
                  {savingDocument ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  保存
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 px-4 py-2.5">
              {headerStats.map((item) => (
                <div
                  key={item.label}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  <span>{item.label}</span>
                  <span className="font-medium text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div className="border-b border-border px-5 py-3">
              <div className="text-sm font-semibold text-foreground">表格数据</div>
              <div className="mt-1 text-xs text-muted-foreground">仅支持修改已有单元格的值，不支持新增或删除行列。</div>
            </div>

            <div className="min-h-0 h-[calc(100%-61px)]">
              {openingDocument ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  正在打开文件
                </div>
              ) : !document ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  请选择左侧文件以查看配置内容。
                </div>
              ) : visibleColumns.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  当前所有列都被隐藏了，请在“列显示”里至少勾选一列。
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="min-w-max p-4">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="sticky left-0 z-20 bg-background text-center">#</TableHead>
                          {visibleColumns.map((column) => (
                            <TableHead key={column} className="min-w-40 bg-background">{column}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {document.rows.length > 0 ? document.rows.map((row, rowIndex) => (
                          <TableRow key={`${document.filePath}-${document.sheetName ?? 'xml'}-${rowIndex}`}>
                            <TableCell className="sticky left-0 z-10 bg-background text-center text-xs text-muted-foreground">
                              {rowIndex + 1}
                            </TableCell>
                            {visibleColumns.map((column) => (
                              <TableCell key={`${rowIndex}-${column}`} className="min-w-40">
                                <Input
                                  value={row[column] ?? ''}
                                  onChange={(event) => handleCellChange(rowIndex, column, event.target.value)}
                                  className="h-8 min-w-32 border-border/70 bg-background"
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                        )) : (
                          <TableRow>
                            <TableCell colSpan={visibleColumns.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                              当前文件没有可展示的数据。
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </section>
      </div>

      <Sheet open={columnSheetOpen} onOpenChange={setColumnSheetOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="size-4 text-primary" />
              列显示控制
            </SheetTitle>
            <SheetDescription>
              默认全选。取消后只隐藏展示，不影响实际保存内容。
            </SheetDescription>
          </SheetHeader>

          <div className="border-b border-border px-5 py-3 text-xs text-muted-foreground">
            共 {document?.columns.length ?? 0} 列，当前显示 {visibleColumns.length} 列
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-5 py-4">
              {document?.columns.length ? document.columns.map((column) => (
                <label
                  key={column}
                  className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-sm text-foreground"
                >
                  <Checkbox
                    checked={!hiddenColumns.has(column)}
                    onCheckedChange={(checked) => toggleColumnVisibility(column, checked === true)}
                  />
                  <span className="min-w-0 flex-1 break-all">{column}</span>
                </label>
              )) : (
                <div className="px-1 py-2 text-sm text-muted-foreground">打开文件后可选择要展示的列。</div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <UnsavedConfigDialog
        open={unsavedDialogOpen}
        onCancel={handleCancelPendingNavigation}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onSaveAndSwitch={() => void handleSaveAndSwitch()}
      />
    </>
  )
}
