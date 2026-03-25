import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Check, ChevronRight, ChevronsUpDown, File, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useProtoStore, type FileInfo, type MessageInfo, type RouteMapping } from '@/stores/protoStore'
import { useCanvasStore, type RequestNodeData } from '@/stores/canvasStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSavedConnectionStore } from '@/stores/savedConnectionStore'
import { deleteRouteMapping, setRouteMapping } from '@/services/api'
import { combineRoute, splitRoute } from '@/types/frame'
import { ProtoImport } from './ProtoImport'

const ROW_HEIGHT = 32
const OVERSCAN = 12

type RequestFile = FileInfo & { Messages: MessageInfo[] }

type RowItem =
  | {
      kind: 'file'
      key: string
      file: RequestFile
      open: boolean
    }
  | {
      kind: 'message'
      key: string
      filePath: string
      message: MessageInfo
      mapping?: RouteMapping
    }

function leafName(name: string): string {
  const parts = name.split('.')
  return parts[parts.length - 1]
}

function messageShortName(message: Pick<MessageInfo, 'Name' | 'ShortName'>): string {
  return message.ShortName || leafName(message.Name)
}

function isCgMessage(message: Pick<MessageInfo, 'Name' | 'ShortName'>): boolean {
  return messageShortName(message).startsWith('Cg')
}

function isGcMessage(message: Pick<MessageInfo, 'Name' | 'ShortName'>): boolean {
  return messageShortName(message).startsWith('Gc')
}

export function ProtoBrowser() {
  const files = useProtoStore((s) => s.files)
  const allMessages = useProtoStore((s) => s.messages)
  const routeMappings = useProtoStore((s) => s.routeMappings)

  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({})
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const requestFiles = useMemo(() => {
    return files
      .map((file) => {
        const requestMessages = (file.Messages ?? []).filter(isCgMessage)
        if (requestMessages.length === 0) return null
        return { ...file, Messages: requestMessages }
      })
      .filter(Boolean) as RequestFile[]
  }, [files])

  const filteredFiles = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return requestFiles

    return requestFiles
      .map((file) => {
        if (file.Path.toLowerCase().includes(q)) return file

        const matched = file.Messages.filter((message) => {
          const shortName = messageShortName(message).toLowerCase()
          return shortName.includes(q) || message.Name.toLowerCase().includes(q)
        })

        if (matched.length === 0) return null
        return { ...file, Messages: matched }
      })
      .filter(Boolean) as RequestFile[]
  }, [deferredSearch, requestFiles])

  const requestCount = useMemo(
    () => requestFiles.reduce((count, file) => count + file.Messages.length, 0),
    [requestFiles],
  )

  const routeMappingByRequest = useMemo(() => {
    const mapping = new Map<string, RouteMapping>()
    routeMappings.forEach((item) => mapping.set(item.requestMsg, item))
    return mapping
  }, [routeMappings])

  const responseMessages = useMemo(
    () => allMessages.filter(isGcMessage),
    [allMessages],
  )

  const isSearching = deferredSearch.trim().length > 0

  const rows = useMemo<RowItem[]>(() => {
    const nextRows: RowItem[] = []

    filteredFiles.forEach((file) => {
      const open = isSearching || !!openFiles[file.Path]
      nextRows.push({
        kind: 'file',
        key: `file:${file.Path}`,
        file,
        open,
      })

      if (!open) return

      file.Messages.forEach((message) => {
        nextRows.push({
          kind: 'message',
          key: `message:${message.Name}`,
          filePath: file.Path,
          message,
          mapping: routeMappingByRequest.get(message.Name),
        })
      })
    })

    return nextRows
  }, [filteredFiles, isSearching, openFiles, routeMappingByRequest])

  const totalHeight = rows.length * ROW_HEIGHT
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  )
  const visibleRows = rows.slice(startIndex, endIndex)

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return

    const updateHeight = () => setViewportHeight(element.clientHeight)
    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setScrollTop(0)
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0
    }
  }, [deferredSearch])

  return (
    <div className="flex h-full flex-col overflow-hidden px-2.5">
      <div className="flex h-8 shrink-0 items-center justify-between px-2">
        <span className="text-xs font-medium text-muted-foreground">请求协议</span>
      </div>

      <div className="shrink-0" style={{ padding: '12px 8px 6px' }}>
        <ProtoImport />
      </div>

      <div className="mb-2 shrink-0 px-2 text-xs font-medium text-muted-foreground">
        Cg 协议 {requestCount > 0 ? `(${requestCount})` : ''}
      </div>

      <div className="shrink-0 rounded-md border border-input shadow-xs" style={{ margin: '0 8px 6px' }}>
        <div className="flex h-7 items-center">
          <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 Cg 协议..."
            className="h-7 border-0 pl-2 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      <div
        ref={viewportRef}
        className="flex-1 min-h-0 overflow-auto px-2"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {rows.length > 0 ? (
          <div style={{ height: totalHeight, position: 'relative' }}>
            {visibleRows.map((row, index) => {
              const absoluteIndex = startIndex + index
              const top = absoluteIndex * ROW_HEIGHT

              return (
                <div
                  key={row.key}
                  className="absolute left-0 right-0"
                  style={{ top, height: ROW_HEIGHT }}
                >
                  {row.kind === 'file' ? (
                    <FileRow
                      file={row.file}
                      open={row.open}
                      lockedOpen={isSearching}
                      onToggle={() =>
                        setOpenFiles((current) => ({
                          ...current,
                          [row.file.Path]: !row.open,
                        }))
                      }
                    />
                  ) : (
                    <MessageRow
                      message={row.message}
                      mapping={row.mapping}
                      responseMessages={responseMessages}
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-4 text-center">
            <span className="text-xs text-muted-foreground">
              {requestFiles.length === 0 ? '未找到可发送的 Cg 协议。' : '没有匹配的 Cg 协议。'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function FileRow({
  file,
  open,
  lockedOpen,
  onToggle,
}: {
  file: RequestFile
  open: boolean
  lockedOpen: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="flex h-full w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      onClick={() => {
        if (!lockedOpen) onToggle()
      }}
      >
        <ChevronRight className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} />
        <File className="size-4 shrink-0" />
        <span className="truncate text-xs">{file.Path}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{file.Messages.length}</span>
      </button>
  )
}

function MessageRow({
  message,
  mapping,
  responseMessages,
}: {
  message: MessageInfo
  mapping?: RouteMapping
  responseMessages: MessageInfo[]
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [routeValues, setRouteValues] = useState<Record<string, number>>({})
  const [singleRoute, setSingleRoute] = useState('')
  const [responseMsg, setResponseMsg] = useState('')
  const [responseMsgOpen, setResponseMsgOpen] = useState(false)

  const addRouteMapping = useProtoStore((s) => s.addRouteMapping)
  const removeRouteMapping = useProtoStore((s) => s.removeRouteMapping)
  const routeFields = useConnectionStore((s) => s.routeFields)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const getConnection = useSavedConnectionStore((s) => s.getConnection)
  const updateNodes = useCanvasStore((s) => s.updateNodes)

  const isPomelo = activeConnectionId
    ? getConnection(activeConnectionId)?.frameConfig?.parserMode === 'pomelo'
    : false
  const hasRouteFields = routeFields.length > 0
  const defaultRoute = message.MessageID ?? 0

  const openDialog = () => {
    if (mapping) {
      if (isPomelo) {
        setSingleRoute(mapping.stringRoute ?? '')
      } else if (hasRouteFields) {
        setRouteValues(splitRoute(mapping.route, routeFields))
      } else {
        setSingleRoute(String(mapping.route))
      }
      setResponseMsg(mapping.responseMsg)
    } else {
      setRouteValues(hasRouteFields && defaultRoute ? splitRoute(defaultRoute, routeFields) : {})
      setSingleRoute(defaultRoute ? String(defaultRoute) : '')
      setResponseMsg('')
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!activeConnectionId) return

    if (isPomelo) {
      const stringRoute = singleRoute.trim()
      if (!stringRoute) return
      await setRouteMapping(0, message.Name, responseMsg, activeConnectionId, stringRoute)
      addRouteMapping({ route: 0, stringRoute, requestMsg: message.Name, responseMsg })
      updateNodes((nodes) =>
        nodes.map((node) =>
          node.type === 'requestNode' && (node.data as RequestNodeData).messageName === message.Name
            ? { ...node, data: { ...node.data, route: 0, stringRoute } }
            : node
        ),
      )
    } else {
      const route = hasRouteFields
        ? combineRoute(routeValues, routeFields)
        : (Number(singleRoute) || 0)
      if (!route) return
      await setRouteMapping(route, message.Name, responseMsg, activeConnectionId)
      addRouteMapping({ route, requestMsg: message.Name, responseMsg })
      updateNodes((nodes) =>
        nodes.map((node) =>
          node.type === 'requestNode' && (node.data as RequestNodeData).messageName === message.Name
            ? { ...node, data: { ...node.data, route } }
            : node
        ),
      )
    }

    setDialogOpen(false)
  }

  const handleDelete = async () => {
    if (!activeConnectionId || !mapping) return
    await deleteRouteMapping(mapping.route, activeConnectionId, mapping.stringRoute)
    removeRouteMapping(mapping.route, mapping.stringRoute)
    setDialogOpen(false)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/flow-packet-message', JSON.stringify(message))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <>
      <button
        type="button"
        className="ml-7 flex h-full w-[calc(100%-28px)] cursor-grab items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        draggable
        onDragStart={handleDragStart}
        onDoubleClick={openDialog}
      >
        <Box className="size-4 shrink-0 text-blue-500" />
        <span className="truncate text-xs">{message.ShortName}</span>
        {(mapping || defaultRoute !== 0) && (
          <Badge
            variant="secondary"
            className="ml-auto h-4 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
          >
            {mapping?.stringRoute || mapping?.route || defaultRoute}
          </Badge>
        )}
      </button>

      {dialogOpen && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>配置协议映射</DialogTitle>
              <DialogDescription>{message.ShortName}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              {isPomelo ? (
                <div className="grid gap-2">
                  <Label>Route</Label>
                  <Input
                    placeholder="game.handler.login"
                    value={singleRoute}
                    onChange={(e) => setSingleRoute(e.target.value)}
                  />
                </div>
              ) : hasRouteFields ? (
                <div className="grid gap-2">
                  <Label>Route</Label>
                  <div className="flex items-center gap-2">
                    {routeFields.map((field) => (
                      <div key={field.name} className="flex-1 grid gap-1">
                        <span className="text-xs uppercase text-muted-foreground">{field.name}</span>
                        <Input
                          type="number"
                          value={routeValues[field.name] ?? ''}
                          onChange={(e) =>
                            setRouteValues({
                              ...routeValues,
                              [field.name]: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label>Route</Label>
                  <Input
                    type="number"
                    placeholder="Route"
                    value={singleRoute}
                    onChange={(e) => setSingleRoute(e.target.value)}
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label>Response Message</Label>
                <Popover open={responseMsgOpen} onOpenChange={setResponseMsgOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={responseMsgOpen}
                      className="w-full justify-between font-normal"
                    >
                      {responseMsg
                        ? responseMessages.find((item) => item.Name === responseMsg)?.ShortName ?? responseMsg
                        : '选择 Gc 协议（可选）'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  {responseMsgOpen && (
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                      <Command>
                        <CommandInput placeholder="搜索 Gc 协议..." />
                        <CommandList>
                          <CommandEmpty>没有匹配的 Gc 协议</CommandEmpty>
                          <CommandGroup>
                            {responseMessages.map((item) => (
                              <CommandItem
                                key={item.Name}
                                value={item.ShortName}
                                onSelect={() => {
                                  setResponseMsg(responseMsg === item.Name ? '' : item.Name)
                                  setResponseMsgOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-4 w-4',
                                    responseMsg === item.Name ? 'opacity-100' : 'opacity-0',
                                  )}
                                />
                                {item.ShortName}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  )}
                </Popover>
              </div>
            </div>

            <DialogFooter>
              {mapping && (
                <Button variant="destructive" size="sm" onClick={handleDelete} className="mr-auto">
                  <Trash2 className="mr-1 size-4" />
                  删除映射
                </Button>
              )}
              <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
              <Button onClick={handleSave}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
