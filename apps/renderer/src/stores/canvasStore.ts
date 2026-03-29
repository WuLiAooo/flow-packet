import { create } from 'zustand'
import type { Node, Edge } from '@xyflow/react'
import { useExecutionStore } from '@/stores/executionStore'

export interface BeginNodeData {
  label: string
  deviceId: string
  [key: string]: unknown
}

export interface RequestNodeData {
  messageName: string
  route: number
  stringRoute?: string
  fields: Record<string, unknown>
  responseFields?: { name: string; type: string }[]
  [key: string]: unknown
}

export interface WaitResponseNodeData {
  messageName: string
  route: number
  stringRoute?: string
  expectedFields?: { name: string; type: string }[]
  [key: string]: unknown
}

export interface CommentNodeData {
  label: string
  color: string
  [key: string]: unknown
}

export type AnyNodeData = BeginNodeData | RequestNodeData | WaitResponseNodeData | CommentNodeData

interface Snapshot {
  nodes: Node<AnyNodeData>[]
  edges: Edge[]
}

const MAX_HISTORY = 50
const BEGIN_LABEL = 'Begin'
const NODE_EDIT_SNAPSHOT_WINDOW_MS = 800

let lastNodeEditSnapshot: { nodeId: string; at: number } | null = null

function resetNodeEditSnapshotWindow() {
  lastNodeEditSnapshot = null
}

function shouldTakeNodeEditSnapshot(nodeId: string): boolean {
  const now = Date.now()

  if (
    !lastNodeEditSnapshot ||
    lastNodeEditSnapshot.nodeId !== nodeId ||
    now - lastNodeEditSnapshot.at > NODE_EDIT_SNAPSHOT_WINDOW_MS
  ) {
    lastNodeEditSnapshot = { nodeId, at: now }
    return true
  }

  lastNodeEditSnapshot = { nodeId, at: now }
  return false
}

function pruneExecutionRuntime(nodes: Node<AnyNodeData>[]) {
  useExecutionStore.getState().pruneNodeRuntime(nodes.map((node) => node.id))
}

export function createBeginNode(): Node<AnyNodeData> {
  return {
    id: `begin_${Date.now()}`,
    type: 'beginNode',
    position: { x: 120, y: 180 },
    data: { label: BEGIN_LABEL, deviceId: '' },
    draggable: true,
    selectable: true,
  }
}

function isBeginNode(node: Node<AnyNodeData>): boolean {
  return node.type === 'beginNode'
}

function normalizeBeginNode(node: Node<AnyNodeData>): Node<AnyNodeData> {
  const rawData = (typeof node.data === 'object' && node.data ? node.data : {}) as Record<string, unknown>
  const deviceId = typeof rawData['deviceId'] === 'string' ? String(rawData['deviceId']) : ''

  return {
    ...node,
    type: 'beginNode',
    data: {
      ...rawData,
      label: BEGIN_LABEL,
      deviceId,
    },
  }
}

export function normalizeCanvasGraph(nodes: Node<AnyNodeData>[], edges: Edge[]): Snapshot {
  const beginNodes = nodes.filter(isBeginNode)
  const primaryBegin = beginNodes[0] ? normalizeBeginNode(beginNodes[0]) : createBeginNode()
  const normalizedNodes = [
    primaryBegin,
    ...nodes.filter((node) => node.id !== primaryBegin.id && node.type !== 'beginNode'),
  ]
  const keptNodeIds = new Set(normalizedNodes.map((node) => node.id))
  const normalizedEdges = edges.filter((edge) => keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target))

  return {
    nodes: normalizedNodes,
    edges: normalizedEdges,
  }
}

function normalizeNodes(nodes: Node<AnyNodeData>[]): Node<AnyNodeData>[] {
  return normalizeCanvasGraph(nodes, []).nodes
}

interface CanvasStore {
  nodes: Node<AnyNodeData>[]
  edges: Edge[]
  selectedNodeId: string | null
  editingNodeId: string | null

  past: Snapshot[]
  future: Snapshot[]

  setNodes: (nodes: Node<AnyNodeData>[]) => void
  setEdges: (edges: Edge[]) => void
  updateNodes: (updater: (nodes: Node<AnyNodeData>[]) => Node<AnyNodeData>[]) => void
  updateEdges: (updater: (edges: Edge[]) => Edge[]) => void
  setSelectedNodeId: (id: string | null) => void
  setEditingNodeId: (id: string | null) => void
  updateNodeData: (nodeId: string, data: Partial<AnyNodeData>) => void
  addNode: (node: Node<AnyNodeData>) => void
  removeNode: (nodeId: string) => void

  takeSnapshot: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

const defaultCanvas = normalizeCanvasGraph([], [])

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: defaultCanvas.nodes,
  edges: defaultCanvas.edges,
  selectedNodeId: null,
  editingNodeId: null,
  past: [],
  future: [],

  takeSnapshot: () => {
    resetNodeEditSnapshotWindow()
    set((s) => ({
      past: [...s.past.slice(-(MAX_HISTORY - 1)), { nodes: s.nodes, edges: s.edges }],
      future: [],
    }))
  },

  undo: () => {
    const { past, nodes, edges } = get()
    if (past.length === 0) return

    const prev = normalizeCanvasGraph(past[past.length - 1].nodes, past[past.length - 1].edges)
    resetNodeEditSnapshotWindow()
    set({
      past: past.slice(0, -1),
      future: [{ nodes, edges }, ...get().future],
      nodes: prev.nodes,
      edges: prev.edges,
    })
    pruneExecutionRuntime(prev.nodes)
  },

  redo: () => {
    const { future, nodes, edges } = get()
    if (future.length === 0) return

    const next = normalizeCanvasGraph(future[0].nodes, future[0].edges)
    resetNodeEditSnapshotWindow()
    set({
      future: future.slice(1),
      past: [...get().past, { nodes, edges }],
      nodes: next.nodes,
      edges: next.edges,
    })
    pruneExecutionRuntime(next.nodes)
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  setNodes: (nodes) => {
    const normalizedNodes = normalizeNodes(nodes)
    set((s) => ({ nodes: normalizedNodes, edges: s.edges }))
    pruneExecutionRuntime(normalizedNodes)
  },
  setEdges: (edges) => set({ edges }),
  updateNodes: (updater) => set((s) => ({ nodes: normalizeNodes(updater(s.nodes)) })),
  updateEdges: (updater) => set((s) => ({ edges: updater(s.edges) })),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setEditingNodeId: (id) => set({ editingNodeId: id }),
  updateNodeData: (nodeId, data) => {
    const node = get().nodes.find((item) => item.id === nodeId)
    if (!node) return

    if (shouldTakeNodeEditSnapshot(nodeId)) {
      get().takeSnapshot()
      lastNodeEditSnapshot = { nodeId, at: Date.now() }
    }

    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    }))
  },
  addNode: (node) => {
    if (node.type === 'beginNode') return
    get().takeSnapshot()
    set((s) => ({ nodes: normalizeNodes([...s.nodes, node]) }))
  },
  removeNode: (nodeId) => {
    const node = get().nodes.find((item) => item.id === nodeId)
    if (!node || isBeginNode(node)) return

    get().takeSnapshot()
    resetNodeEditSnapshotWindow()
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
      editingNodeId: s.editingNodeId === nodeId ? null : s.editingNodeId,
    }))
    useExecutionStore.getState().clearNodeRuntime(nodeId)
  },
}))