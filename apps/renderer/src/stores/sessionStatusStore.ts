import { create } from 'zustand'

export interface SessionStatusEntry {
  connectionId: string
  deviceId: string
  state: string
  error?: string
  updatedAt: number
}

interface SessionStatusStore {
  statuses: Record<string, SessionStatusEntry>

  setStatus: (status: Omit<SessionStatusEntry, 'updatedAt'>) => void
  clearStatus: (connectionId: string, deviceId: string) => void
  clearAll: () => void
  clearConnection: (connectionId: string) => void
  getStatus: (connectionId: string, deviceId: string) => SessionStatusEntry | undefined
}

function makeKey(connectionId: string, deviceId: string): string {
  return `${connectionId}::${deviceId}`
}

export const useSessionStatusStore = create<SessionStatusStore>((set, get) => ({
  statuses: {},

  setStatus: (status) =>
    set((state) => ({
      statuses: {
        ...state.statuses,
        [makeKey(status.connectionId, status.deviceId)]: {
          ...status,
          updatedAt: Date.now(),
        },
      },
    })),

  clearStatus: (connectionId, deviceId) =>
    set((state) => {
      const key = makeKey(connectionId, deviceId)
      if (!(key in state.statuses)) {
        return state
      }
      const next = { ...state.statuses }
      delete next[key]
      return { statuses: next }
    }),

  clearAll: () => set({ statuses: {} }),

  clearConnection: (connectionId) =>
    set((state) => {
      const next = { ...state.statuses }
      for (const [key, value] of Object.entries(next)) {
        if (value.connectionId === connectionId) {
          delete next[key]
        }
      }
      return { statuses: next }
    }),

  getStatus: (connectionId, deviceId) => get().statuses[makeKey(connectionId, deviceId)],
}))
