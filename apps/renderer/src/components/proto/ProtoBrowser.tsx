import { useState, useMemo } from 'react'
import { ChevronRight, File, Box, Trash2, Search, Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useProtoStore, type FileInfo, type MessageInfo } from '@/stores/protoStore'
import { useCanvasStore, type RequestNodeData } from '@/stores/canvasStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { setRouteMapping, deleteRouteMapping } from '@/services/api'
import { combineRoute, splitRoute } from '@/types/frame'
import { ProtoImport } from './ProtoImport'

export function ProtoBrowser() {
  const files = useProtoStore((s) => s.files)
  const [search, setSearch] = useState('')

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files
    const q = search.toLowerCase()
    return files
      .map((file) => {
        if (file.Path.toLowerCase().includes(q)) return file
        const matched = (file.Messages ?? []).filter(
          (m) => m.ShortName.toLowerCase().includes(q) || m.Name.toLowerCase().includes(q)
        )
        if (matched.length === 0) return null
        return { ...file, Messages: matched }
      })
      .filter(Boolean) as typeof files
  }, [files, search])

  const isSearching = search.trim().length > 0

  return (
    <div className="flex flex-col h-full px-2.5 overflow-hidden">
      <div className="flex items-center justify-between px-2 h-8 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          协议浏览器
        </span>
      </div>

      <div className="shrink-0" style={{ padding: '12px 8px 6px' }}>
        <ProtoImport />
      </div>

      <div className="shrink-0 px-2 text-xs font-medium text-muted-foreground mb-2">
        Proto 文件
      </div>
      <div className="shrink-0 flex items-center h-7 rounded-md border border-input shadow-xs" style={{ margin: '0 8px 6px' }}>
        <Search className="ml-2 w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索协议或消息..."
          className="h-7 pl-2 text-xs border-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <ScrollArea className="flex-1 min-h-0 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!min-h-full">
        <SidebarGroup className="pt-0" style={{ padding: '0 8px' }}>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredFiles.map((file) => (
                <FileNode key={file.Path} file={file} forceOpen={isSearching} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {files.length === 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs text-muted-foreground">
              尚未导入 Proto 文件
            </span>
          </div>
        )}
        {isSearching && filteredFiles.length === 0 && files.length > 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs text-muted-foreground">
              没有匹配的协议或消息
            </span>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function FileNode({ file, forceOpen }: { file: FileInfo; forceOpen?: boolean }) {
  return (
    <SidebarMenuItem>
      <Collapsible
        defaultOpen
        open={forceOpen || undefined}
        className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton>
            <ChevronRight className="transition-transform" />
            <File />
            {file.Path}
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className="flex flex-col gap-1 border-l border-border py-0.5"
            style={{ marginLeft: 28, paddingLeft: 16 }}
          >
            {file.Messages?.map((msg) => (
              <MessageNode key={msg.Name} message={msg} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

function MessageNode({ message }: { message: MessageInfo }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const routeMappings = useProtoStore((s) => s.routeMappings)
  const addRouteMapping = useProtoStore((s) => s.addRouteMapping)
  const removeRouteMapping = useProtoStore((s) => s.removeRouteMapping)
  const routeFields = useConnectionStore((s) => s.routeFields)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)

  const updateNodes = useCanvasStore((s) => s.updateNodes)

  const existing = routeMappings.find((m) => m.requestMsg === message.Name)
  const hasRouteFields = routeFields.length > 0

  const messages = useProtoStore((s) => s.messages)

  const [routeValues, setRouteValues] = useState<Record<string, number>>({})
  const [singleRoute, setSingleRoute] = useState('')
  const [responseMsg, setResponseMsg] = useState('')
  const [responseMsgOpen, setResponseMsgOpen] = useState(false)

  const openDialog = () => {
    if (existing) {
      if (hasRouteFields) {
        setRouteValues(splitRoute(existing.route, routeFields))
      } else {
        setSingleRoute(String(existing.route))
      }
      setResponseMsg(existing.responseMsg)
    } else {
      setRouteValues({})
      setSingleRoute('')
      setResponseMsg('')
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!activeConnectionId) return
    const route = hasRouteFields
      ? combineRoute(routeValues, routeFields)
      : (Number(singleRoute) || 0)
    if (!route) return

    await setRouteMapping(route, message.Name, responseMsg, activeConnectionId)
    addRouteMapping({ route, requestMsg: message.Name, responseMsg })
    updateNodes((nodes) =>
      nodes.map((n) =>
        n.type === 'requestNode' && (n.data as RequestNodeData).messageName === message.Name
          ? { ...n, data: { ...n.data, route } }
          : n
      )
    )
    setDialogOpen(false)
  }

  const handleDelete = async () => {
    if (!activeConnectionId || !existing) return
    await deleteRouteMapping(existing.route, activeConnectionId)
    removeRouteMapping(existing.route)
    setDialogOpen(false)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/flow-packet-message', JSON.stringify(message))
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <>
      <SidebarMenuButton
        className="cursor-grab"
        draggable
        onDragStart={handleDragStart}
        onDoubleClick={openDialog}
      >
        <Box className="text-blue-500" />
        <span className="truncate">{message.ShortName}</span>
        {existing && (
          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground">
            {existing.route}
          </Badge>
        )}
      </SidebarMenuButton>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>设置模板</DialogTitle>
            <DialogDescription>{message.ShortName}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {hasRouteFields ? (
              <div className="grid gap-2">
                <Label>路由</Label>
                <div className="flex items-center gap-2">
                  {routeFields.map((rf) => (
                    <div key={rf.name} className="flex-1 grid gap-1">
                      <span className="text-xs text-muted-foreground uppercase">{rf.name}</span>
                      <Input
                        type="number"
                        value={routeValues[rf.name] ?? ''}
                        onChange={(e) =>
                          setRouteValues({ ...routeValues, [rf.name]: Number(e.target.value) || 0 })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>路由</Label>
                <Input
                  type="number"
                  placeholder="路由值"
                  value={singleRoute}
                  onChange={(e) => setSingleRoute(e.target.value)}
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label>响应 Message</Label>
              <Popover open={responseMsgOpen} onOpenChange={setResponseMsgOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={responseMsgOpen}
                    className="w-full justify-between font-normal"
                  >
                    {responseMsg
                      ? messages.find((m) => m.Name === responseMsg)?.ShortName ?? responseMsg
                      : '选择响应消息 (可选)'}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="搜索消息..." />
                    <CommandList>
                      <CommandEmpty>没有匹配的消息</CommandEmpty>
                      <CommandGroup>
                        {messages.map((m) => (
                          <CommandItem
                            key={m.Name}
                            value={m.ShortName}
                            onSelect={() => {
                              setResponseMsg(responseMsg === m.Name ? '' : m.Name)
                              setResponseMsgOpen(false)
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                responseMsg === m.Name ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            {m.ShortName}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <DialogFooter>
            {existing && (
              <Button variant="destructive" size="sm" onClick={handleDelete} className="mr-auto">
                <Trash2 className="size-4 mr-1" />
                删除路由
              </Button>
            )}
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
