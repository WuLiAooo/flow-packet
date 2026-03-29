import { create } from 'zustand'
import type { Node, Edge } from '@xyflow/react'
import type { AnyNodeData } from './canvasStore'
import { normalizeCanvasGraph, useCanvasStore } from './canvasStore'
import { useConnectionStore } from './connectionStore'

export interface CanvasTab {
  id: string
  name: string
  collectionId?: string
  nodes: Node<AnyNodeData>[]
  edges: Edge[]
  dirty: boolean
}

interface PersistedTabSession {
  tabs: CanvasTab[]
  activeTabId: string | null
}

interface TabStore {
  tabs: CanvasTab[]
  activeTabId: string | null

  addTab: () => void
  duplicateTab: (tabId: string) => void
  openTab: (name: string, collectionId: string, nodes: Node<AnyNodeData>[], edges: Edge[]) => void
  switchTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  renameTab: (tabId: string, name: string) => void
  markClean: (tabId: string) => void
  setCollectionId: (tabId: string, collectionId: string) => void
  loadConnectionTabs: (connectionId: string) => void
  persistTabsForConnection: (connectionId: string) => void
  _saveActiveTab: () => void
  resetTabs: () => void
}

const STORAGE_KEY = 'flow-packet-tabs-by-connection'

function createDefaultTab(): CanvasTab {
  const canvas = normalizeCanvasGraph([], [])
  return {
    id: crypto.randomUUID(),
    name: 'Untitled',
    nodes: canvas.nodes,
    edges: canvas.edges,
    dirty: false,
  }
}

function loadPersistedSessions(): Record<string, PersistedTabSession> {
  if (typeof localStorage === 'undefined') return {}

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, PersistedTabSession>
  } catch {
    return {}
  }
}

function persistSessions(sessions: Record<string, PersistedTabSession>) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

function normalizeTab(tab: CanvasTab): CanvasTab {
  const normalized = normalizeCanvasGraph(tab.nodes ?? [], tab.edges ?? [])
  const name = typeof tab.name === 'string' && tab.name.trim() ? tab.name : 'Untitled'

  return {
    id: typeof tab.id === 'string' && tab.id ? tab.id : crypto.randomUUID(),
    name,
    collectionId: typeof tab.collectionId === 'string' && tab.collectionId ? tab.collectionId : undefined,
    nodes: normalized.nodes,
    edges: normalized.edges,
    dirty: Boolean(tab.dirty),
  }
}

function createFallbackSession(): PersistedTabSession {
  const tab = createDefaultTab()
  return {
    tabs: [tab],
    activeTabId: tab.id,
  }
}

function cloneGraph(nodes: Node<AnyNodeData>[], edges: Edge[]) {
  return normalizeCanvasGraph(structuredClone(nodes), structuredClone(edges))
}

function createDuplicateTabName(name: string, tabs: CanvasTab[]): string {
  const baseName = name.trim() || 'Untitled'
  const existingNames = new Set(tabs.map((tab) => tab.name))

  for (let index = 1; ; index += 1) {
    const candidate = `${baseName}-${index}`
    if (!existingNames.has(candidate)) {
      return candidate
    }
  }
}

function getPersistedSession(connectionId: string): PersistedTabSession {
  const session = loadPersistedSessions()[connectionId]
  if (!session || !Array.isArray(session.tabs) || session.tabs.length === 0) {
    return createFallbackSession()
  }

  const tabs = session.tabs.map(normalizeTab)
  const activeTabId = session.activeTabId && tabs.some((tab) => tab.id === session.activeTabId)
    ? session.activeTabId
    : tabs[0]?.id ?? null

  return {
    tabs,
    activeTabId,
  }
}

function persistConnectionTabs(connectionId: string, tabs: CanvasTab[], activeTabId: string | null) {
  const sessions = loadPersistedSessions()
  sessions[connectionId] = { tabs, activeTabId }
  persistSessions(sessions)
}

function persistActiveConnectionTabs(snapshot: { tabs: CanvasTab[]; activeTabId: string | null }) {
  const connectionId = useConnectionStore.getState().activeConnectionId
  if (!connectionId) return
  persistConnectionTabs(connectionId, snapshot.tabs, snapshot.activeTabId)
}

let _switching = false

const defaultSession = createFallbackSession()

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: defaultSession.tabs,
  activeTabId: defaultSession.activeTabId,

  _saveActiveTab: () => {
    const { activeTabId, tabs } = get()
    if (!activeTabId) return
    const canvas = useCanvasStore.getState()
    const normalized = normalizeCanvasGraph(canvas.nodes, canvas.edges)
    set({
      tabs: tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, nodes: normalized.nodes, edges: normalized.edges }
          : t,
      ),
    })
    persistActiveConnectionTabs(get())
  },

  renameTab: (tabId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, name: trimmed, dirty: true } : t,
      ),
    }))
    persistActiveConnectionTabs(get())
  },

  markClean: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)),
    }))
    persistActiveConnectionTabs(get())
  },

  setCollectionId: (tabId, collectionId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, collectionId } : t)),
    }))
    persistActiveConnectionTabs(get())
  },

  loadConnectionTabs: (connectionId) => {
    const session = getPersistedSession(connectionId)
    const activeTab = session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0] ?? createDefaultTab()
    const normalized = normalizeCanvasGraph(activeTab.nodes, activeTab.edges)

    _switching = true
    set({ tabs: session.tabs, activeTabId: activeTab.id })
    useCanvasStore.getState().setNodes(normalized.nodes)
    useCanvasStore.getState().setEdges(normalized.edges)
    _switching = false

    persistConnectionTabs(connectionId, session.tabs, activeTab.id)
  },

  persistTabsForConnection: (connectionId) => {
    get()._saveActiveTab()
    const { tabs, activeTabId } = get()
    persistConnectionTabs(connectionId, tabs, activeTabId)
  },

  addTab: () => {
    const { _saveActiveTab } = get()
    _saveActiveTab()
    const tab = createDefaultTab()
    _switching = true
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    useCanvasStore.getState().setNodes(tab.nodes)
    useCanvasStore.getState().setEdges(tab.edges)
    _switching = false
    persistActiveConnectionTabs(get())
  },

  duplicateTab: (tabId) => {
    const { tabs, activeTabId, _saveActiveTab } = get()
    const source = tabs.find((tab) => tab.id === tabId)
    if (!source) return

    if (tabId === activeTabId) {
      _saveActiveTab()
    }

    const latestTabs = get().tabs
    const latestSource = latestTabs.find((tab) => tab.id === tabId)
    if (!latestSource) return

    const canvas = cloneGraph(latestSource.nodes, latestSource.edges)
    const duplicatedTab: CanvasTab = {
      id: crypto.randomUUID(),
      name: createDuplicateTabName(latestSource.name, latestTabs),
      nodes: canvas.nodes,
      edges: canvas.edges,
      dirty: true,
    }

    _switching = true
    set((s) => ({ tabs: [...s.tabs, duplicatedTab], activeTabId: duplicatedTab.id }))
    useCanvasStore.getState().setNodes(duplicatedTab.nodes)
    useCanvasStore.getState().setEdges(duplicatedTab.edges)
    _switching = false
    persistActiveConnectionTabs(get())
  },

  openTab: (name, collectionId, nodes, edges) => {
    const { tabs, _saveActiveTab } = get()
    const existing = tabs.find((t) => t.collectionId === collectionId)
    if (existing) {
      get().switchTab(existing.id)
      return
    }
    _saveActiveTab()
    const normalized = normalizeCanvasGraph(nodes, edges)
    const tab: CanvasTab = {
      id: crypto.randomUUID(),
      name,
      collectionId,
      nodes: normalized.nodes,
      edges: normalized.edges,
      dirty: false,
    }
    _switching = true
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
    useCanvasStore.getState().setNodes(normalized.nodes)
    useCanvasStore.getState().setEdges(normalized.edges)
    _switching = false
    persistActiveConnectionTabs(get())
  },

  switchTab: (tabId) => {
    const { activeTabId, tabs, _saveActiveTab } = get()
    if (tabId === activeTabId) return
    _saveActiveTab()
    const target = tabs.find((t) => t.id === tabId)
    if (!target) return
    const normalized = normalizeCanvasGraph(target.nodes, target.edges)
    _switching = true
    set({ activeTabId: tabId })
    useCanvasStore.getState().setNodes(normalized.nodes)
    useCanvasStore.getState().setEdges(normalized.edges)
    _switching = false
    persistActiveConnectionTabs(get())
  },

  resetTabs: () => {
    const session = createFallbackSession()
    _switching = true
    set({ tabs: session.tabs, activeTabId: session.activeTabId })
    useCanvasStore.getState().setNodes(session.tabs[0].nodes)
    useCanvasStore.getState().setEdges(session.tabs[0].edges)
    _switching = false
    persistActiveConnectionTabs(get())
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId, _saveActiveTab } = get()
    if (activeTabId && activeTabId !== tabId) {
      _saveActiveTab()
    }
    const idx = tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return
    const newTabs = tabs.filter((t) => t.id !== tabId)

    if (tabId === activeTabId) {
      let nextId: string | null = null
      if (newTabs.length > 0) {
        const nextIdx = Math.min(idx, newTabs.length - 1)
        nextId = newTabs[nextIdx].id
      }
      _switching = true
      set({ tabs: newTabs, activeTabId: nextId })
      if (nextId) {
        const next = newTabs.find((t) => t.id === nextId)!
        const normalized = normalizeCanvasGraph(next.nodes, next.edges)
        useCanvasStore.getState().setNodes(normalized.nodes)
        useCanvasStore.getState().setEdges(normalized.edges)
      } else {
        const blank = normalizeCanvasGraph([], [])
        useCanvasStore.getState().setNodes(blank.nodes)
        useCanvasStore.getState().setEdges(blank.edges)
      }
      _switching = false
    } else {
      set({ tabs: newTabs })
    }

    persistActiveConnectionTabs(get())
  },
}))

useCanvasStore.subscribe((state, prev) => {
  if (_switching) return
  if (state.nodes === prev.nodes && state.edges === prev.edges) return
  const { activeTabId } = useTabStore.getState()
  if (!activeTabId) return

  useTabStore.setState((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === activeTabId
        ? { ...t, nodes: state.nodes, edges: state.edges, dirty: true }
        : t,
    ),
  }))

  persistActiveConnectionTabs(useTabStore.getState())
})

