import { subscribe } from './ws'
import { useConnectionStore } from '@/stores/connectionStore'
import { useExecutionStore } from '@/stores/executionStore'
import { useSessionStatusStore, type SessionRuntimeInfo } from '@/stores/sessionStatusStore'

function appendLog(entry: {
  nodeId: string
  type: 'request' | 'response' | 'error' | 'info'
  messageName?: string
  data: Record<string, unknown>
  duration?: number
}) {
  useExecutionStore.getState().addLog({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...entry,
  })
}

function shortMessageName(messageName?: string): string {
  if (!messageName) return ''
  const parts = messageName.split('.')
  return parts[parts.length - 1] ?? ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function normalizeRuntimeValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }
  return undefined
}

function extractBeginSessionRuntime(messageName?: string, payload?: Record<string, unknown>): SessionRuntimeInfo | null {
  if (shortMessageName(messageName) !== 'GcPlayerInfo') return null

  const root = asRecord(payload)
  const playerInfo = asRecord(root?.playerInfo)
  if (!playerInfo) return null

  const roleId = normalizeRuntimeValue(playerInfo.roleId)
  const allianceId = normalizeRuntimeValue(playerInfo.allianceId)
  if (!roleId && !allianceId) return null

  return {
    ...(roleId ? { roleId } : {}),
    ...(allianceId ? { allianceId } : {}),
  }
}

export function initEventBindings(): () => void {
  const unsubs: (() => void)[] = []

  unsubs.push(
    subscribe('conn.status', (payload) => {
      const data = payload as {
        connectionId?: string
        state: string
        addr?: string
        error?: string
      }
      const store = useConnectionStore.getState()
      if (data.state === 'connected') {
        store.setState('connected')
        if (data.addr) store.setTargetAddr(data.addr)
      } else if (data.state === 'disconnected') {
        store.setState('disconnected')
      } else if (data.state === 'reconnecting') {
        store.setState('reconnecting')
      }

      appendLog({
        nodeId: data.connectionId ? `connection:${data.connectionId}` : 'connection',
        type: data.error ? 'error' : 'info',
        messageName: 'conn.status',
        data: {
          state: data.state,
          ...(data.addr ? { addr: data.addr } : {}),
          ...(data.error ? { error: data.error } : {}),
        },
      })
    })
  )

  unsubs.push(
    subscribe('session.status', (payload) => {
      const data = payload as {
        connectionId: string
        deviceId: string
        state: string
        error?: string
      }
      if (!data.connectionId || !data.deviceId) return
      useSessionStatusStore.getState().setStatus({
        connectionId: data.connectionId,
        deviceId: data.deviceId,
        state: data.state,
        error: data.error,
      })

      appendLog({
        nodeId: `session:${data.deviceId}`,
        type: data.error || data.state === 'error' ? 'error' : 'info',
        messageName: 'session.status',
        data: {
          state: data.state,
          connectionId: data.connectionId,
          ...(data.error ? { error: data.error } : {}),
        },
      })
    })
  )

  unsubs.push(
    subscribe('packet.received', (payload) => {
      const data = payload as {
        connectionId: string
        deviceId?: string
        source?: string
        route?: number
        stringRoute?: string
        seq?: number
        messageName?: string
        data?: Record<string, unknown>
      }
      const scope = data.deviceId
        ? `session:${data.deviceId}`
        : (data.source === 'connection' ? 'server' : 'wire')

      appendLog({
        nodeId: scope,
        type: 'response',
        messageName: data.messageName || data.stringRoute || (data.route ? String(data.route) : undefined),
        data: data.data ?? {},
      })

      if (!data.connectionId || !data.deviceId) return
      const runtime = extractBeginSessionRuntime(data.messageName, data.data)
      if (!runtime) return
      useSessionStatusStore.getState().setRuntimeInfo(data.connectionId, data.deviceId, runtime)
    })
  )

  unsubs.push(
    subscribe('node.result', (payload) => {
      const data = payload as {
        nodeId: string
        requestMsg?: string
        responseMsg?: string
        request?: Record<string, unknown>
        response?: Record<string, unknown>
        duration?: number
      }
      const store = useExecutionStore.getState()

      store.setNodeStatus(data.nodeId, {
        nodeId: data.nodeId,
        status: 'success',
      })

      if (data.requestMsg || data.request) {
        appendLog({
          nodeId: data.nodeId,
          type: 'request',
          messageName: data.requestMsg,
          data: data.request ?? {},
        })
      }

      if (data.response !== undefined) {
        store.setNodeOutput(data.nodeId, {
          messageName: data.responseMsg,
          data: data.response ?? {},
          duration: data.duration,
          timestamp: Date.now(),
        })
      }
    })
  )

  unsubs.push(
    subscribe('node.error', (payload) => {
      const data = payload as { nodeId: string; error: string }
      const store = useExecutionStore.getState()

      store.setNodeStatus(data.nodeId, {
        nodeId: data.nodeId,
        status: 'error',
        error: data.error,
      })

      appendLog({
        nodeId: data.nodeId,
        type: 'error',
        data: { error: data.error },
      })
    })
  )

  unsubs.push(
    subscribe('node.start', (payload) => {
      const data = payload as { nodeId: string }
      const store = useExecutionStore.getState()

      store.setNodeStatus(data.nodeId, {
        nodeId: data.nodeId,
        status: 'running',
      })

      appendLog({
        nodeId: data.nodeId,
        type: 'info',
        data: { message: 'executing' },
      })
    })
  )

  unsubs.push(
    subscribe('flow.complete', () => {
      useExecutionStore.getState().setStatus('completed')
    })
  )

  unsubs.push(
    subscribe('flow.started', () => {
      const store = useExecutionStore.getState()
      store.setStatus('running')
      store.clearLogs()
      store.resetNodeStatuses()
      store.clearNodeOutputs()
    })
  )

  unsubs.push(
    subscribe('flow.error', (payload) => {
      const data = payload as { error: string }
      const store = useExecutionStore.getState()
      store.setStatus('error')
      appendLog({
        nodeId: 'flow',
        type: 'error',
        data: { error: data.error },
      })
    })
  )

  return () => {
    unsubs.forEach((unsub) => unsub())
  }
}
