import { create } from 'zustand'

export type ExecutionStatus = 'idle' | 'running' | 'completed' | 'error' | 'stopped'
const MAX_LOGS = 200

export interface LogEntry {
  id: string
  timestamp: number
  nodeId: string
  type: 'request' | 'response' | 'error' | 'info'
  messageName?: string
  data: Record<string, unknown>
  duration?: number
}

export interface NodeStatus {
  nodeId: string
  status: 'pending' | 'running' | 'success' | 'error'
  error?: string
}

export interface NodeOutput {
  messageName?: string
  data: Record<string, unknown>
  duration?: number
  timestamp: number
}

interface ExecutionStore {
  status: ExecutionStatus
  logs: LogEntry[]
  nodeStatuses: Record<string, NodeStatus>
  nodeOutputs: Record<string, NodeOutput>

  setStatus: (status: ExecutionStatus) => void
  addLog: (log: LogEntry) => void
  clearLogs: () => void
  setNodeStatus: (nodeId: string, status: NodeStatus) => void
  resetNodeStatuses: () => void
  setNodeOutput: (nodeId: string, output: NodeOutput) => void
  clearNodeOutputs: () => void
}

export const useExecutionStore = create<ExecutionStore>((set) => ({
  status: 'idle',
  logs: [],
  nodeStatuses: {},
  nodeOutputs: {},

  setStatus: (status) => set({ status }),
  addLog: (log) =>
    set((s) => ({
      logs: [...s.logs, log].slice(-MAX_LOGS),
    })),
  clearLogs: () => set({ logs: [] }),
  setNodeStatus: (nodeId, status) =>
    set((s) => ({
      nodeStatuses: { ...s.nodeStatuses, [nodeId]: status },
    })),
  resetNodeStatuses: () => set({ nodeStatuses: {} }),
  setNodeOutput: (nodeId, output) =>
    set((s) => ({
      nodeOutputs: { ...s.nodeOutputs, [nodeId]: output },
    })),
  clearNodeOutputs: () => set({ nodeOutputs: {} }),
}))
