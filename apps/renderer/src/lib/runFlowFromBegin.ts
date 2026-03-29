import type { Edge, Node } from '@xyflow/react'
import { toast } from 'sonner'
import { executeFlow } from '@/services/api'
import {
  type AnyNodeData,
  type BeginNodeData,
  type RequestNodeData,
  type WaitResponseNodeData,
} from '@/stores/canvasStore'
import type { ExecutionStatus } from '@/stores/executionStore'
import type { SessionStatusEntry } from '@/stores/sessionStatusStore'
import { formatValidationMessage, getExecutableFlowFromBegin } from './flowGraph'

interface RunFlowFromBeginParams {
  nodes: Node<AnyNodeData>[]
  edges: Edge[]
  activeConnectionId: string | null
  connectionState: string
  executionStatus: ExecutionStatus
  getSessionStatus: (connectionId: string, deviceId: string) => SessionStatusEntry | undefined
}

export async function runFlowFromBegin({
  nodes,
  edges,
  activeConnectionId,
  connectionState,
  executionStatus,
  getSessionStatus,
}: RunFlowFromBeginParams): Promise<boolean> {
  if (!activeConnectionId) {
    toast.error('No active connection')
    return false
  }

  if (connectionState !== 'connected') {
    toast.error('Connection unavailable', {
      description: 'Connect to the server first before running this chain.',
    })
    return false
  }

  if (executionStatus === 'running') {
    toast.error('Flow is already running')
    return false
  }

  if (nodes.length === 0) {
    toast.error('Canvas is empty')
    return false
  }

  const beginNode = nodes.find((node) => node.type === 'beginNode')
  if (!beginNode) {
    toast.error('Begin node is missing')
    return false
  }

  const beginData = beginNode.data as BeginNodeData | undefined
  const deviceId = typeof beginData?.deviceId === 'string' ? beginData.deviceId.trim() : ''
  if (!deviceId) {
    toast.error('Begin deviceId required', {
      description: 'Double-click BeginNode and configure the deviceId before running this chain.',
    })
    return false
  }

  const sessionStatus = getSessionStatus(activeConnectionId, deviceId)
  if (sessionStatus?.state !== 'ready') {
    toast.error('Begin session not ready', {
      description: 'Right-click BeginNode and choose Login before running this chain.',
    })
    return false
  }

  const executable = getExecutableFlowFromBegin(nodes, edges)
  if (!executable.validation.valid) {
    toast.error('Invalid flow', {
      description: formatValidationMessage(executable.validation),
    })
    return false
  }

  try {
    const flowNodes = executable.nodes.map((node) => {
      if (node.type === 'requestNode') {
        const requestData = node.data as RequestNodeData
        return {
          id: node.id,
          type: 'request',
          messageName: requestData.messageName,
          route: requestData.route,
          stringRoute: requestData.stringRoute,
          fields: requestData.fields,
        }
      }

      const waitData = node.data as WaitResponseNodeData
      return {
        id: node.id,
        type: 'wait_response',
        messageName: waitData.messageName,
        route: waitData.route,
        stringRoute: waitData.stringRoute,
        fields: {},
      }
    })
    const flowEdges = executable.edges.map((edge) => ({ source: edge.source, target: edge.target }))
    await executeFlow(flowNodes, flowEdges, activeConnectionId, deviceId)
    return true
  } catch {
    return false
  }
}
