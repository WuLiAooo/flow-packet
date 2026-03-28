import type { Node, XYPosition } from '@xyflow/react'
import type { MessageInfo, RouteMapping } from '@/stores/protoStore'
import type { RequestNodeData, WaitResponseNodeData } from '@/stores/canvasStore'

export type DraggedProtocolKind = 'request' | 'wait_response'

export interface DraggedProtocolMessage {
  kind: DraggedProtocolKind
  message: MessageInfo
}

export function parseDraggedProtocolMessage(raw: string): DraggedProtocolMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DraggedProtocolMessage>
    if (!parsed || !parsed.message || !parsed.kind) return null
    if (parsed.kind !== 'request' && parsed.kind !== 'wait_response') return null
    return parsed as DraggedProtocolMessage
  } catch {
    return null
  }
}

export function createRequestNode(
  message: MessageInfo,
  routeMappings: RouteMapping[],
  position: XYPosition,
): Node<RequestNodeData> {
  const mapping = routeMappings.find((item) => item.requestMsg === message.Name)

  return {
    id: `node_${Date.now()}`,
    type: 'requestNode',
    position,
    data: {
      messageName: message.Name,
      route: mapping?.route ?? message.MessageID ?? 0,
      stringRoute: mapping?.stringRoute,
      fields: {},
      responseFields: message.Fields?.map((field) => ({
        name: field.name,
        type: field.type,
      })),
    },
  }
}

export function createWaitResponseNode(
  message: MessageInfo,
  position: XYPosition,
): Node<WaitResponseNodeData> {
  return {
    id: `node_${Date.now()}`,
    type: 'waitResponseNode',
    position,
    data: {
      messageName: message.Name,
      route: message.MessageID ?? 0,
      expectedFields: message.Fields?.map((field) => ({
        name: field.name,
        type: field.type,
      })),
    },
  }
}
