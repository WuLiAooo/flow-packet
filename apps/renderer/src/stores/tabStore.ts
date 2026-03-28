import { create } from 'zustand'
import type { Node, Edge } from '@xyflow/react'
import type { AnyNodeData } from './canvasStore'
import { normalizeCanvasGraph, useCanvasStore } from './canvasStore'

export interface CanvasTab {
  id: string
  name: string
  collectionId?: string
  nodes: Node<AnyNodeData>[]
  edges: Edge[]
  dirty: boolean
}

interface TabStore {
  tabs: CanvasTab[]
  activeTabId: string | null

  addTab: () => void
  openTab: (name: string, collectionId: string, nodes: Node<AnyNodeData>[], edges: Edge[]) => void
  switchTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  renameTab: (tabId: string, name: string) => void
  markClean: (tabId: string) => void
  setCollectionId: (tabId: string, collectionId: string) => void
  _saveActiveTab: () => void
  resetTabs: () => void
}

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

let _switching = false

const defaultTab = createDefaultTab()

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [defaultTab],
  activeTabId: defaultTab.id,

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
  },

  renameTab: (tabId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, name: trimmed, dirty: true } : t,
      ),
    }))
  },

  markClean: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false } : t)),
    }))
  },

  setCollectionId: (tabId, collectionId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, collectionId } : t)),
    }))
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
  },

  resetTabs: () => {
    const tab = createDefaultTab()
    _switching = true
    set({ tabs: [tab], activeTabId: tab.id })
    useCanvasStore.getState().setNodes(tab.nodes)
    useCanvasStore.getState().setEdges(tab.edges)
    _switching = false
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
  },
}))

useCanvasStore.subscribe((state, prev) => {
  if (_switching) return
  if (state.nodes === prev.nodes && state.edges === prev.edges) return
  const { activeTabId } = useTabStore.getState()
  if (!activeTabId) return
  useTabStore.setState((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === activeTabId ? { ...t, dirty: true } : t,
    ),
  }))
})
