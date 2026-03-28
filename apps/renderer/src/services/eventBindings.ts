import { subscribe } from './ws'
import { useConnectionStore } from '@/stores/connectionStore'
import { useExecutionStore } from '@/stores/executionStore'

export function initEventBindings(): () => void {
  const unsubs: (() => void)[] = []

  unsubs.push(
    subscribe('conn.status', (payload) => {
      const data = payload as { state: string; addr?: string }
      const store = useConnectionStore.getState()
      if (data.state === 'connected') {
        store.setState('connected')
        if (data.addr) store.setTargetAddr(data.addr)
      } else if (data.state === 'disconnected') {
        store.setState('disconnected')
      } else if (data.state === 'reconnecting') {
        store.setState('reconnecting')
      }
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
        store.addLog({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          nodeId: data.nodeId,
          type: 'request',
          messageName: data.requestMsg,
          data: data.request ?? {},
        })
      }

      if (data.response !== undefined) {
        store.addLog({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          nodeId: data.nodeId,
          type: 'response',
          messageName: data.responseMsg,
          data: data.response ?? {},
          duration: data.duration,
        })
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

      store.addLog({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
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

      store.addLog({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
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
      store.addLog({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
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
