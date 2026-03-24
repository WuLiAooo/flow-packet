import { useMemo, useState } from 'react'
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
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
import { useProtoStore, type FileInfo, type MessageInfo } from '@/stores/protoStore'
import { useCanvasStore, type RequestNodeData } from '@/stores/canvasStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSavedConnectionStore } from '@/stores/savedConnectionStore'
import { deleteRouteMapping, setRouteMapping } from '@/services/api'
import { combineRoute, splitRoute } from '@/types/frame'
import { ProtoImport } from './ProtoImport'

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
  const [search, setSearch] = useState('')

  const requestFiles = useMemo(() => {
    return files
      .map((file) => {
        const requestMessages = (file.Messages ?? []).filter(isCgMessage)
        if (requestMessages.length === 0) return null
        return { ...file, Messages: requestMessages }
      })
      .filter(Boolean) as FileInfo[]
  }, [files])

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return requestFiles
    const q = search.toLowerCase()

    return requestFiles
      .map((file) => {
        if (file.Path.toLowerCase().includes(q)) return file

        const matched = (file.Messages ?? []).filter((message) => {
          const shortName = messageShortName(message).toLowerCase()
          return shortName.includes(q) || message.Name.toLowerCase().includes(q)
        })

        if (matched.length === 0) return null
        return { ...file, Messages: matched }
      })
      .filter(Boolean) as FileInfo[]
  }, [requestFiles, search])

  const requestCount = useMemo(
    () => requestFiles.reduce((count, file) => count + (file.Messages?.length ?? 0), 0),
    [requestFiles],
  )

  const isSearching = search.trim().length > 0

  return (
    <div className="flex h-full flex-col overflow-hidden px-2.5">
      <div className="flex h-8 shrink-0 items-center justify-between px-2">
        <span className="text-xs font-medium text-muted-foreground">Request Protocols</span>
      </div>

      <div className="shrink-0" style={{ padding: '12px 8px 6px' }}>
        <ProtoImport />
      </div>

      <div className="mb-2 shrink-0 px-2 text-xs font-medium text-muted-foreground">
        Cg messages {requestCount > 0 ? `(${requestCount})` : ''}
      </div>

      <div className="shrink-0 rounded-md border border-input shadow-xs" style={{ margin: '0 8px 6px' }}>
        <div className="flex h-7 items-center">
          <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Cg messages..."
            className="h-7 border-0 pl-2 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
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

        {requestFiles.length === 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs text-muted-foreground">No sendable Cg messages found.</span>
          </div>
        )}

        {isSearching && filteredFiles.length === 0 && requestFiles.length > 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs text-muted-foreground">No matching Cg messages.</span>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

function FileNode({ file, forceOpen }: { file: FileInfo; forceOpen?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <SidebarMenuItem>
      <Collapsible
        open={forceOpen ? true : open}
        onOpenChange={(next) => {
          if (!forceOpen) setOpen(next)
        }}
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
            {file.Messages?.map((message) => (
              <MessageNode key={message.Name} message={message} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

function MessageNode({ message }: { message: MessageInfo }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [routeValues, setRouteValues] = useState<Record<string, number>>({})
  const [singleRoute, setSingleRoute] = useState('')
  const [responseMsg, setResponseMsg] = useState('')
  const [responseMsgOpen, setResponseMsgOpen] = useState(false)

  const routeMappings = useProtoStore((s) => s.routeMappings)
  const addRouteMapping = useProtoStore((s) => s.addRouteMapping)
  const removeRouteMapping = useProtoStore((s) => s.removeRouteMapping)
  const allMessages = useProtoStore((s) => s.messages)
  const routeFields = useConnectionStore((s) => s.routeFields)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const getConnection = useSavedConnectionStore((s) => s.getConnection)
  const updateNodes = useCanvasStore((s) => s.updateNodes)

  const isPomelo = activeConnectionId
    ? getConnection(activeConnectionId)?.frameConfig?.parserMode === 'pomelo'
    : false
  const existing = routeMappings.find((mapping) => mapping.requestMsg === message.Name)
  const hasRouteFields = routeFields.length > 0
  const defaultRoute = message.MessageID ?? 0

  const responseMessages = useMemo(
    () => allMessages.filter(isGcMessage),
    [allMessages],
  )

  const openDialog = () => {
    if (existing) {
      if (isPomelo) {
        setSingleRoute(existing.stringRoute ?? '')
      } else if (hasRouteFields) {
        setRouteValues(splitRoute(existing.route, routeFields))
      } else {
        setSingleRoute(String(existing.route))
      }
      setResponseMsg(existing.responseMsg)
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
    if (!activeConnectionId || !existing) return
    await deleteRouteMapping(existing.route, activeConnectionId, existing.stringRoute)
    removeRouteMapping(existing.route, existing.stringRoute)
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
        {(existing || defaultRoute !== 0) && (
          <Badge
            variant="secondary"
            className="ml-auto h-4 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
          >
            {existing?.stringRoute || existing?.route || defaultRoute}
          </Badge>
        )}
      </SidebarMenuButton>

      {dialogOpen && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Configure Mapping</DialogTitle>
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
                        : 'Select Gc message (optional)'}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  {responseMsgOpen && (
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                      <Command>
                        <CommandInput placeholder="Search Gc messages..." />
                        <CommandList>
                          <CommandEmpty>No matching Gc messages</CommandEmpty>
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
              {existing && (
                <Button variant="destructive" size="sm" onClick={handleDelete} className="mr-auto">
                  <Trash2 className="mr-1 size-4" />
                  Delete Mapping
                </Button>
              )}
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
