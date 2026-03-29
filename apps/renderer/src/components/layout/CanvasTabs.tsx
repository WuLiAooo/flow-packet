import { useRef, useState, useEffect, useCallback } from 'react'
import { LayoutDashboard, Plus, X, ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { useTabStore, type CanvasTab } from '@/stores/tabStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useCollectionStore } from '@/stores/collectionStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { SaveCollectionDialog } from '@/components/collection/SaveCollectionDialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SaveIntent = 'save' | 'close'

interface PendingSave {
  tab: CanvasTab
  intent: SaveIntent
}

function defaultSaveName(tab: CanvasTab | null): string {
  if (!tab) return ''
  return tab.name === 'Untitled' ? '' : tab.name
}

export function CanvasTabs() {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const addTab = useTabStore((s) => s.addTab)
  const switchTab = useTabStore((s) => s.switchTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const renameTab = useTabStore((s) => s.renameTab)
  const markClean = useTabStore((s) => s.markClean)
  const setCollectionId = useTabStore((s) => s.setCollectionId)

  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)

  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const [showLeft, setShowLeft] = useState(false)
  const [showRight, setShowRight] = useState(false)

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowLeft(el.scrollLeft > 0)
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    checkOverflow()
  }, [tabs, checkOverflow])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkOverflow)
    const ro = new ResizeObserver(checkOverflow)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', checkOverflow)
      ro.disconnect()
    }
  }, [checkOverflow])

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' })
  }

  const beginRename = (tab: CanvasTab) => {
    setEditingTabId(tab.id)
    setDraftName(tab.name)
  }

  const commitRename = () => {
    if (!editingTabId) return
    const trimmed = draftName.trim()
    if (trimmed) {
      renameTab(editingTabId, trimmed)
    }
    setEditingTabId(null)
    setDraftName('')
  }

  const cancelRename = () => {
    setEditingTabId(null)
    setDraftName('')
  }

  const saveTab = async (tab: CanvasTab, intent: SaveIntent) => {
    if (!activeConnectionId) return

    const canvas = useCanvasStore.getState()
    const nodes = tab.id === activeTabId ? canvas.nodes : tab.nodes
    const edges = tab.id === activeTabId ? canvas.edges : tab.edges

    if (tab.collectionId) {
      await useCollectionStore.getState().updateCollection(activeConnectionId, tab.collectionId, nodes, edges)
      markClean(tab.id)
      if (intent === 'close') {
        closeTab(tab.id)
      }
      return
    }

    setPendingSave({ tab, intent })
  }

  const handleCloseClick = async (tab: CanvasTab) => {
    if (!tab.dirty) {
      closeTab(tab.id)
      return
    }

    if (tab.collectionId) {
      await saveTab(tab, 'close')
      return
    }

    setPendingSave({ tab, intent: 'close' })
  }

  const handleContextClose = (tab: CanvasTab) => {
    if (pendingSave?.tab.id === tab.id) {
      setPendingSave(null)
    }
    closeTab(tab.id)
  }

  const handleSaveDialogConfirm = async (name: string, folderId: string) => {
    if (!pendingSave || !activeConnectionId) return

    const canvas = useCanvasStore.getState()
    const tab = pendingSave.tab
    const nodes = tab.id === activeTabId ? canvas.nodes : tab.nodes
    const edges = tab.id === activeTabId ? canvas.edges : tab.edges

    const collectionId = await useCollectionStore.getState().saveCollection(
      activeConnectionId,
      name,
      folderId,
      nodes,
      edges,
    )
    setCollectionId(tab.id, collectionId)
    renameTab(tab.id, name)
    markClean(tab.id)
    if (pendingSave.intent === 'close') {
      closeTab(tab.id)
    }
    setPendingSave(null)
  }

  const handleSaveDialogCancel = () => {
    if (pendingSave?.intent === 'close') {
      closeTab(pendingSave.tab.id)
    }
    setPendingSave(null)
  }

  return (
    <>
      <div className="flex items-center h-9 border-b border-border shrink-0" style={{ background: 'var(--bg-panel)' }}>
        {showLeft && (
          <button
            onClick={() => scroll('left')}
            className="flex items-center justify-center w-6 h-full shrink-0 hover:bg-accent text-muted-foreground"
          >
            <ChevronLeft className="size-3.5" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex-1 flex items-center h-full overflow-hidden min-w-0"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            const isDirty = tab.dirty
            const isEditing = editingTabId === tab.id

            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <div
                    onClick={() => switchTab(tab.id)}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      beginRename(tab)
                    }}
                    className={cn(
                      'group flex items-center gap-2 h-full pl-3 pr-1 pt-1 shrink-0 cursor-pointer border-r border-border select-none min-w-[120px] border-t-2',
                      'text-xs',
                      isActive ? 'bg-background text-foreground border-t-primary' : 'border-t-transparent text-muted-foreground/50',
                    )}
                  >
                    <LayoutDashboard className="size-3.5 shrink-0" />
                    {isEditing ? (
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') cancelRename()
                        }}
                        className="h-6 min-w-0 text-xs"
                        autoFocus
                      />
                    ) : (
                      <span className="truncate">{tab.name}</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleCloseClick(tab)
                      }}
                      className={cn(
                        'flex items-center justify-center size-4 rounded-sm ml-auto shrink-0 hover:bg-muted-foreground/20',
                        isActive || isDirty ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      {isDirty ? (
                        <>
                          <span className="w-2 h-2 rounded-full bg-foreground group-hover:hidden" />
                          <X className="size-3 hidden group-hover:block" />
                        </>
                      ) : (
                        <X className="size-3" />
                      )}
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => beginRename(tab)}>
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void saveTab(tab, 'save')}>
                    <Save className="size-4" />
                    <span>Save</span>
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleContextClose(tab)}>
                    Close
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })}

          <button
            onClick={addTab}
            className="flex items-center justify-center size-7 mx-1 shrink-0 rounded-sm hover:bg-accent text-muted-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {showRight && (
          <button
            onClick={() => scroll('right')}
            className="flex items-center justify-center w-6 h-full shrink-0 hover:bg-accent text-muted-foreground"
          >
            <ChevronRight className="size-3.5" />
          </button>
        )}
      </div>

      <SaveCollectionDialog
        open={!!pendingSave}
        defaultName={defaultSaveName(pendingSave?.tab ?? null)}
        onOpenChange={(open) => {
          if (!open) handleSaveDialogCancel()
        }}
        onSave={handleSaveDialogConfirm}
      />
    </>
  )
}
