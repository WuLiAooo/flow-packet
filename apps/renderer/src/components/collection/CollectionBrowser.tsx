import { useRef, useState } from 'react'
import { ChevronRight, Folder, FolderPlus, LayoutDashboard, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/ui/sidebar'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCollectionStore, type CollectionFolder, type CollectionSummary } from '@/stores/collectionStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTabStore } from '@/stores/tabStore'

type DragItem = { type: 'folder'; id: string } | { type: 'collection'; id: string }

let dragItem: DragItem | null = null

export function CollectionBrowser() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const folders = useCollectionStore((s) => s.folders)
  const collections = useCollectionStore((s) => s.collections)
  const createFolder = useCollectionStore((s) => s.createFolder)
  const moveFolder = useCollectionStore((s) => s.moveFolder)
  const moveCollection = useCollectionStore((s) => s.moveCollection)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name || !activeConnectionId) return
    await createFolder(activeConnectionId, name, '')
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const handleDrop = (targetFolderId: string) => {
    if (!dragItem || !activeConnectionId) return

    if (dragItem.type === 'folder') {
      if (dragItem.id === targetFolderId) return
      void moveFolder(activeConnectionId, dragItem.id, targetFolderId)
    } else {
      void moveCollection(activeConnectionId, dragItem.id, targetFolderId)
    }

    dragItem = null
  }

  const rootFolders = folders.filter((f) => !f.parentId)
  const root集合 = collections.filter((c) => !c.folderId)

  return (
    <div className="flex h-full flex-col" style={{ paddingLeft: 10 }}>
      <div className="flex h-8 shrink-0 items-center justify-between px-2">
        <span className="text-xs font-medium text-muted-foreground">集合</span>
        <button
          onClick={() => {
            setCreatingFolder(true)
            setNewFolderName('')
          }}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </div>

      <ScrollArea
        className="flex-1"
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          handleDrop('')
        }}
      >
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {rootFolders.map((folder) => (
                <FolderNode
                  key={folder.id}
                  folder={folder}
                  folders={folders}
                  collections={collections}
                  onDrop={handleDrop}
                />
              ))}
              {root集合.map((collection) => (
                <CollectionNode key={collection.id} collection={collection} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {rootFolders.length === 0 && root集合.length === 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs text-muted-foreground">暂无已保存集合</span>
          </div>
        )}
      </ScrollArea>

      <Dialog open={creatingFolder} onOpenChange={setCreatingFolder}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="文件夹名称"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatingFolder(false)}>
              取消
            </Button>
            <Button onClick={() => void handleCreateFolder()} disabled={!newFolderName.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FolderNode({
  folder,
  folders,
  collections,
  onDrop,
}: {
  folder: CollectionFolder
  folders: CollectionFolder[]
  collections: CollectionSummary[]
  onDrop: (targetFolderId: string) => void
}) {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const renameFolder = useCollectionStore((s) => s.renameFolder)
  const deleteFolder = useCollectionStore((s) => s.deleteFolder)
  const createFolder = useCollectionStore((s) => s.createFolder)

  const [isOpen, setIsOpen] = useState(false)
  const [renameOpen, set重命名Open] = useState(false)
  const [renameName, set重命名Name] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const dragCountRef = useRef(0)

  const childFolders = folders.filter((f) => f.parentId === folder.id)
  const child集合 = collections.filter((c) => c.folderId === folder.id)

  const handle重命名Start = () => {
    set重命名Name(folder.name)
    set重命名Open(true)
  }

  const handle重命名确认 = () => {
    const name = renameName.trim()
    if (!name || !activeConnectionId) return
    void renameFolder(activeConnectionId, folder.id, name)
    set重命名Open(false)
  }

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name || !activeConnectionId) return
    await createFolder(activeConnectionId, name, folder.id)
    setCreateOpen(false)
    setNewFolderName('')
    setIsOpen(true)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    dragItem = { type: 'folder', id: folder.id }
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current += 1
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current -= 1
    if (dragCountRef.current === 0) {
      setDragOver(false)
    }
  }

  const handleDropOnFolder = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current = 0
    setDragOver(false)
    onDrop(folder.id)
  }

  return (
    <SidebarMenuItem>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="group/collapsible">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              draggable
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDropOnFolder}
              className={dragOver ? 'rounded-md bg-sidebar-accent' : ''}
            >
              <SidebarMenuButton onClick={() => setIsOpen((value) => !value)}>
                <ChevronRight className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <Folder />
                <span className="truncate">{folder.name}</span>
              </SidebarMenuButton>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => { setNewFolderName(''); setCreateOpen(true) }}>
              <FolderPlus />
              <span>新建文件夹</span>
            </ContextMenuItem>
            <ContextMenuItem onClick={handle重命名Start}>
              <Pencil />
              <span>重命名</span>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => activeConnectionId && void deleteFolder(activeConnectionId, folder.id)}
            >
              <Trash2 />
              <span>删除</span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <CollapsibleContent>
          <SidebarMenuSub>
            {childFolders.map((childFolder) => (
              <FolderNode
                key={childFolder.id}
                folder={childFolder}
                folders={folders}
                collections={collections}
                onDrop={onDrop}
              />
            ))}
            {child集合.map((collection) => (
              <CollectionNode key={collection.id} collection={collection} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={renameOpen} onOpenChange={set重命名Open}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>重命名文件夹</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="文件夹名称"
            value={renameName}
            onChange={(e) => set重命名Name(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handle重命名确认()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => set重命名Open(false)}>
              取消
            </Button>
            <Button onClick={handle重命名确认} disabled={!renameName.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="文件夹名称"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleCreateFolder()} disabled={!newFolderName.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  )
}

function CollectionNode({ collection }: { collection: CollectionSummary }) {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const renameCollection = useCollectionStore((s) => s.renameCollection)
  const deleteCollection = useCollectionStore((s) => s.deleteCollection)
  const loadCollection = useCollectionStore((s) => s.loadCollection)
  const tabs = useTabStore((s) => s.tabs)
  const switchTab = useTabStore((s) => s.switchTab)
  const openTab = useTabStore((s) => s.openTab)

  const [renameOpen, set重命名Open] = useState(false)
  const [renameName, set重命名Name] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLoad = async () => {
    const existingTab = tabs.find((tab) => tab.collectionId === collection.id)
    if (existingTab) {
      switchTab(existingTab.id)
      return
    }

    if (!activeConnectionId || loading) return

    setLoading(true)
    try {
      const detail = await loadCollection(activeConnectionId, collection.id)
      openTab(collection.name, collection.id, detail.nodes, detail.edges)
    } catch (err) {
      toast.error('加载集合失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setLoading(false)
    }
  }

  const handle重命名Start = () => {
    set重命名Name(collection.name)
    set重命名Open(true)
  }

  const handle重命名确认 = () => {
    const name = renameName.trim()
    if (!name || !activeConnectionId) return
    void renameCollection(activeConnectionId, collection.id, name)
    set重命名Open(false)
  }

  const handle删除 = () => {
    if (!activeConnectionId) return
    void deleteCollection(activeConnectionId, collection.id)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    dragItem = { type: 'collection', id: collection.id }
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div draggable onDragStart={handleDragStart}>
            <SidebarMenuButton
              onClick={() => void handleLoad()}
              className="active:bg-sidebar-accent active:text-sidebar-accent-foreground"
            >
              <LayoutDashboard />
              <span className="truncate">{collection.name}</span>
            </SidebarMenuButton>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handle重命名Start}>
            <Pencil />
            <span>重命名</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={handle删除}>
            <Trash2 />
            <span>删除</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={set重命名Open}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>重命名集合</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="集合名称"
            value={renameName}
            onChange={(e) => set重命名Name(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handle重命名确认()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => set重命名Open(false)}>
              取消
            </Button>
            <Button onClick={handle重命名确认} disabled={!renameName.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  )
}