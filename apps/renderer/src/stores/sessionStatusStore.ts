import { create } from 'zustand'

export interface SessionRuntimeInfo {
  roleId?: string
  allianceId?: string
}

export interface SessionStatusEntry {
  connectionId: string
  deviceId: string
  state: string
  error?: string
  runtime?: SessionRuntimeInfo
  updatedAt: number
}

interface SessionStatusStore {
  statuses: Record<string, SessionStatusEntry>

  setStatus: (status: Omit<SessionStatusEntry, 'updatedAt' | 'runtime'>) => void
  setRuntimeInfo: (connectionId: string, deviceId: string, runtime: SessionRuntimeInfo) => void
  clearStatus: (connectionId: string, deviceId: string) => void
  clearRuntimeInfo: (connectionId: string, deviceId: string) => void
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
    set((state) => {
      const key = makeKey(status.connectionId, status.deviceId)
      const previous = state.statuses[key]

      return {
        statuses: {
          ...state.statuses,
          [key]: {
            ...status,
            runtime: status.state === 'ready' ? previous?.runtime : undefined,
            updatedAt: Date.now(),
          },
        },
      }
    }),

  setRuntimeInfo: (connectionId, deviceId, runtime) =>
    set((state) => {
      const key = makeKey(connectionId, deviceId)
      const previous = state.statuses[key]

      return {
        statuses: {
          ...state.statuses,
          [key]: {
            connectionId,
            deviceId,
            state: previous?.state ?? 'ready',
            error: previous?.error,
            runtime: {
              ...previous?.runtime,
              ...runtime,
            },
            updatedAt: Date.now(),
          },
        },
      }
    }),

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

  clearRuntimeInfo: (connectionId, deviceId) =>
    set((state) => {
      const key = makeKey(connectionId, deviceId)
      const entry = state.statuses[key]
      if (!entry?.runtime) {
        return state
      }

      return {
        statuses: {
          ...state.statuses,
          [key]: {
            ...entry,
            runtime: undefined,
            updatedAt: Date.now(),
          },
        },
      }
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
