import { useState, useEffect, useRef } from 'react'
import { MoreHorizontal, Pencil, Trash2, Folder, FolderPlus, ChevronRight, LayoutDashboard, GripVertical } from 'lucide-react'
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from '@/components/ui/sidebar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCollectionStore, type Collection, type CollectionFolder } from '@/stores/collectionStore'
import { useTabStore } from '@/stores/tabStore'

type DragItem = { type: 'folder'; id: string } | { type: 'collection'; id: string }

let dragItem: DragItem | null = null

export function CollectionBrowser() {
  const folders = useCollectionStore((s) => s.folders)
  const collections = useCollectionStore((s) => s.collections)
  const loadCollections = useCollectionStore((s) => s.loadCollections)
  const createFolder = useCollectionStore((s) => s.createFolder)
  const moveFolder = useCollectionStore((s) => s.moveFolder)
  const moveCollection = useCollectionStore((s) => s.moveCollection)

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  useEffect(() => {
    loadCollections()
  }, [loadCollections])

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    await createFolder(name, '')
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const handleDrop = (targetFolderId: string) => {
    if (!dragItem) return
    if (dragItem.type === 'folder') {
      if (dragItem.id === targetFolderId) return
      moveFolder(dragItem.id, targetFolderId)
    } else {
      moveCollection(dragItem.id, targetFolderId)
    }
    dragItem = null
  }

  const rootFolders = folders.filter((f) => !f.parentId)
  const rootCollections = collections.filter((c) => !c.folderId)

  return (
    <div className="flex flex-col h-full" style={{ paddingLeft: 10 }}>
      <div className="flex items-center justify-between px-2 h-8 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">集合</span>
        <button
          onClick={() => {
            setCreatingFolder(true)
            setNewFolderName('')
          }}
          className="flex items-center justify-center size-5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-accent-foreground"
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
                <FolderNode key={folder.id} folder={folder} folders={folders} collections={collections} onDrop={handleDrop} />
              ))}
              {rootCollections.map((col) => (
                <CollectionNode key={col.id} collection={col} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {rootFolders.length === 0 && rootCollections.length === 0 && (
          <div className="px-3 py-4 text-center">
            <span className="text-xs text-muted-foreground">尚未保存任何集合</span>
          </div>
        )}
      </ScrollArea>

      <Dialog open={creatingFolder} onOpenChange={setCreatingFolder}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>新建集合</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="集合名称"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatingFolder(false)}>
              取消
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
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
  collections: Collection[]
  onDrop: (targetFolderId: string) => void
}) {
  const renameFolder = useCollectionStore((s) => s.renameFolder)
  const deleteFolder = useCollectionStore((s) => s.deleteFolder)
  const createFolder = useCollectionStore((s) => s.createFolder)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const dragCountRef = useRef(0)

  const childFolders = folders.filter((f) => f.parentId === folder.id)
  const childCollections = collections.filter((c) => c.folderId === folder.id)

  const handleRenameStart = () => {
    setRenameName(folder.name)
    setRenameOpen(true)
  }

  const handleRenameConfirm = () => {
    const name = renameName.trim()
    if (!name) return
    renameFolder(folder.id, name)
    setRenameOpen(false)
  }

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    await createFolder(name, folder.id)
    setCreateOpen(false)
    setNewFolderName('')
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
    dragCountRef.current++
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCountRef.current--
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
      <Collapsible className="group/collapsible">
        <div
          draggable
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDropOnFolder}
          className={`flex items-center group/folder ${dragOver ? 'bg-sidebar-accent rounded-md' : ''}`}
        >
          <GripVertical className="size-3 shrink-0 opacity-0 group-hover/folder:opacity-50 cursor-grab text-muted-foreground" />
          <CollapsibleTrigger asChild>
            <SidebarMenuButton className="flex-1">
              <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
              <Folder />
              <span className="truncate">{folder.name}</span>
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction showOnHover>
                <MoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem onClick={() => { setNewFolderName(''); setCreateOpen(true) }}>
                <FolderPlus />
                <span>新建文件夹</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleRenameStart}>
                <Pencil />
                <span>重命名</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => deleteFolder(folder.id)}>
                <Trash2 />
                <span>删除</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CollapsibleContent>
          <SidebarMenuSub>
            {childFolders.map((f) => (
              <FolderNode key={f.id} folder={f} folders={folders} collections={collections} onDrop={onDrop} />
            ))}
            {childCollections.map((col) => (
              <CollectionNode key={col.id} collection={col} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>重命名文件夹</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="文件夹名称"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameConfirm()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRenameConfirm} disabled={!renameName.trim()}>
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
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  )
}

function CollectionNode({ collection }: { collection: Collection }) {
  const renameCollection = useCollectionStore((s) => s.renameCollection)
  const deleteCollection = useCollectionStore((s) => s.deleteCollection)
  const openTab = useTabStore((s) => s.openTab)

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')

  const handleLoad = () => {
    openTab(collection.name, collection.id, collection.nodes, collection.edges)
  }

  const handleRenameStart = () => {
    setRenameName(collection.name)
    setRenameOpen(true)
  }

  const handleRenameConfirm = () => {
    const name = renameName.trim()
    if (!name) return
    renameCollection(collection.id, name)
    setRenameOpen(false)
  }

  const handleDelete = () => {
    deleteCollection(collection.id)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation()
    dragItem = { type: 'collection', id: collection.id }
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <SidebarMenuItem>
      <div
        draggable
        onDragStart={handleDragStart}
        className="flex items-center group/collection"
      >
        <GripVertical className="size-3 shrink-0 opacity-0 group-hover/collection:opacity-50 cursor-grab text-muted-foreground" />
        <SidebarMenuButton
          onClick={handleLoad}
          className="flex-1 active:bg-sidebar-accent active:text-sidebar-accent-foreground"
        >
          <LayoutDashboard />
          <span className="truncate">{collection.name}</span>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover>
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onClick={handleRenameStart}>
              <Pencil />
              <span>重命名</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              <Trash2 />
              <span>删除</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>重命名集合</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="集合名称"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameConfirm()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button onClick={handleRenameConfirm} disabled={!renameName.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  )
}
