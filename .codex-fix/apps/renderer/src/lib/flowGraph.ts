import type { Connection, Edge, Node } from '@xyflow/react'
import type { AnyNodeData } from '@/stores/canvasStore'

type ExecNode = Node<AnyNodeData>
type ExecNodeType = 'requestNode' | 'waitResponseNode'
export type WaitNodeMode = 'continue' | 'observe' | 'standalone'

interface ValidationResult {
  valid: boolean
  error?: string
}

interface RequestTargets {
  directRequestTargets: string[]
  continuingWaitTargets: string[]
  plainWaitTargets: string[]
}

function isExecEdge(edge: Edge): boolean {
  return edge.type === 'execEdge'
}

function isExecNodeType(type: string | undefined): type is ExecNodeType {
  return type === 'requestNode' || type === 'waitResponseNode'
}

function buildNodeMap(nodes: ExecNode[]): Map<string, ExecNode> {
  return new Map(
    nodes.filter((node) => isExecNodeType(node.type)).map((node) => [node.id, node]),
  )
}

function buildAdjacency(nodes: ExecNode[], edges: Edge[]) {
  const nodeMap = buildNodeMap(nodes)
  const execEdges = edges
    .filter(isExecEdge)
    .filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target))
  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()

  nodeMap.forEach((_, nodeId) => {
    incoming.set(nodeId, [])
    outgoing.set(nodeId, [])
  })

  execEdges.forEach((edge) => {
    incoming.get(edge.target)?.push(edge.source)
    outgoing.get(edge.source)?.push(edge.target)
  })

  return { nodeMap, execEdges, incoming, outgoing }
}

function getRequestTargets(
  requestId: string,
  nodeMap: Map<string, ExecNode>,
  outgoing: Map<string, string[]>,
): RequestTargets {
  const directRequestTargets: string[] = []
  const continuingWaitTargets: string[] = []
  const plainWaitTargets: string[] = []

  for (const targetId of outgoing.get(requestId) ?? []) {
    const target = nodeMap.get(targetId)
    if (!target) continue

    if (target.type === 'requestNode') {
      directRequestTargets.push(targetId)
      continue
    }

    const waitOutgoing = outgoing.get(targetId) ?? []
    if (waitOutgoing.length === 0) {
      plainWaitTargets.push(targetId)
    } else {
      continuingWaitTargets.push(targetId)
    }
  }

  return { directRequestTargets, continuingWaitTargets, plainWaitTargets }
}

function isObserverWait(
  waitId: string,
  nodeMap: Map<string, ExecNode>,
  incoming: Map<string, string[]>,
  outgoing: Map<string, string[]>,
): boolean {
  const node = nodeMap.get(waitId)
  if (!node || node.type !== 'waitResponseNode') return false

  const parents = incoming.get(waitId) ?? []
  const children = outgoing.get(waitId) ?? []
  if (parents.length !== 1 || children.length !== 0) return false

  const parent = nodeMap.get(parents[0])
  if (!parent || parent.type !== 'requestNode') return false

  const { directRequestTargets, continuingWaitTargets, plainWaitTargets } = getRequestTargets(parent.id, nodeMap, outgoing)
  if (directRequestTargets.length === 0 && continuingWaitTargets.length === 0 && plainWaitTargets.length === 1) {
    return false
  }

  return true
}

function validateStructuralRules(nodes: ExecNode[], edges: Edge[]): ValidationResult {
  const { nodeMap, execEdges, incoming, outgoing } = buildAdjacency(nodes, edges)

  if (nodeMap.size === 0) {
    return { valid: false, error: 'Flow has no executable nodes.' }
  }

  for (const edge of execEdges) {
    if (edge.source === edge.target) {
      return { valid: false, error: 'A node cannot connect to itself.' }
    }

    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue

    if (source.type === 'waitResponseNode' && target.type !== 'requestNode') {
      return { valid: false, error: 'Gc nodes can only continue to a Cg node.' }
    }
    if (target.type === 'waitResponseNode' && source.type !== 'requestNode') {
      return { valid: false, error: 'Only a Cg node can connect into a Gc node.' }
    }
  }

  for (const [nodeId, node] of nodeMap) {
    const nodeIncoming = incoming.get(nodeId) ?? []
    const nodeOutgoing = outgoing.get(nodeId) ?? []

    if (node.type === 'waitResponseNode') {
      if (nodeIncoming.length > 1) {
        return { valid: false, error: 'Each Gc node can only have one parent Cg node.' }
      }
      if (nodeOutgoing.length > 1) {
        return { valid: false, error: 'Each Gc node can only continue to one Cg node.' }
      }
      if (nodeIncoming.length === 1 && nodeMap.get(nodeIncoming[0])?.type !== 'requestNode') {
        return { valid: false, error: 'A Gc node must be attached to a Cg node.' }
      }
      if (nodeOutgoing.length === 1 && nodeMap.get(nodeOutgoing[0])?.type !== 'requestNode') {
        return { valid: false, error: 'A Gc node can only continue to a Cg node.' }
      }
      continue
    }

    const { directRequestTargets, continuingWaitTargets } = getRequestTargets(nodeId, nodeMap, outgoing)

    if (directRequestTargets.length > 1) {
      return { valid: false, error: 'Each Cg node can only continue to one next Cg node.' }
    }
    if (continuingWaitTargets.length > 1) {
      return { valid: false, error: 'Each Cg node can only have one Gc branch that continues execution.' }
    }
    if (directRequestTargets.length > 0 && continuingWaitTargets.length > 0) {
      return { valid: false, error: 'A Cg node cannot continue through both a direct Cg edge and a Gc branch.' }
    }
  }

  for (const [nodeId, node] of nodeMap) {
    if (node.type !== 'waitResponseNode' || !isObserverWait(nodeId, nodeMap, incoming, outgoing)) {
      continue
    }

    const parentId = (incoming.get(nodeId) ?? [])[0]
    if (!parentId) {
      return { valid: false, error: 'Observer Gc nodes must hang off a single Cg node.' }
    }
  }

  return { valid: true }
}

export function getWaitNodeMode(nodeId: string, nodes: ExecNode[], edges: Edge[]): WaitNodeMode {
  const { nodeMap, incoming, outgoing } = buildAdjacency(nodes, edges)
  const node = nodeMap.get(nodeId)
  if (!node || node.type !== 'waitResponseNode') return 'standalone'

  if ((outgoing.get(nodeId) ?? []).length > 0) {
    return 'continue'
  }

  if (isObserverWait(nodeId, nodeMap, incoming, outgoing)) {
    return 'observe'
  }

  const parents = incoming.get(nodeId) ?? []
  if (parents.length === 1 && nodeMap.get(parents[0])?.type === 'requestNode') {
    return 'continue'
  }

  return 'standalone'
}

export function validateFlowGraph(nodes: ExecNode[], edges: Edge[]): ValidationResult {
  const structural = validateStructuralRules(nodes, edges)
  if (!structural.valid) {
    return structural
  }

  const { nodeMap, incoming, outgoing } = buildAdjacency(nodes, edges)
  const observerWaitIds = new Set<string>()
  const nextNodeById = new Map<string, string>()

  for (const [nodeId, node] of nodeMap) {
    const nodeOutgoing = outgoing.get(nodeId) ?? []

    if (node.type === 'waitResponseNode') {
      if (nodeOutgoing.length === 1) {
        nextNodeById.set(nodeId, nodeOutgoing[0])
      }
      continue
    }

    const { directRequestTargets, continuingWaitTargets, plainWaitTargets } = getRequestTargets(
      nodeId,
      nodeMap,
      outgoing,
    )

    let observerWaitTargets: string[] = []
    if (plainWaitTargets.length > 0) {
      if (directRequestTargets.length === 0 && continuingWaitTargets.length === 0 && plainWaitTargets.length === 1) {
        nextNodeById.set(nodeId, plainWaitTargets[0])
      } else {
        observerWaitTargets = plainWaitTargets
      }
    }

    observerWaitTargets.forEach((waitId) => observerWaitIds.add(waitId))

    if (directRequestTargets.length === 1) {
      nextNodeById.set(nodeId, directRequestTargets[0])
    }
    if (continuingWaitTargets.length === 1) {
      nextNodeById.set(nodeId, continuingWaitTargets[0])
    }
  }

  for (const nodeId of observerWaitIds) {
    if (!isObserverWait(nodeId, nodeMap, incoming, outgoing)) {
      return { valid: false, error: 'Observer Gc nodes must hang off a single Cg node.' }
    }
  }

  const mainNodeIds = [...nodeMap.keys()].filter((nodeId) => !observerWaitIds.has(nodeId))
  const indegree = new Map<string, number>(mainNodeIds.map((nodeId) => [nodeId, 0]))

  for (const [sourceId, targetId] of nextNodeById) {
    if (!indegree.has(sourceId) || !indegree.has(targetId)) continue
    const nextDegree = (indegree.get(targetId) ?? 0) + 1
    if (nextDegree > 1) {
      return { valid: false, error: 'A Cg node cannot have multiple incoming execution paths.' }
    }
    indegree.set(targetId, nextDegree)
  }

  const starts = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([nodeId]) => nodeId)
  if (starts.length === 0) {
    return { valid: false, error: 'No start node was found. The flow contains a cycle.' }
  }
  if (starts.length > 1) {
    return { valid: false, error: 'The flow must have exactly one start node.' }
  }

  const visited = new Set<string>()
  let currentId: string | undefined = starts[0]
  while (currentId) {
    if (visited.has(currentId)) {
      return { valid: false, error: `The flow contains a cycle at node ${currentId}.` }
    }
    visited.add(currentId)
    currentId = nextNodeById.get(currentId)
  }

  if (visited.size !== mainNodeIds.length) {
    return { valid: false, error: 'The flow contains disconnected executable nodes.' }
  }

  return { valid: true }
}

export function validateExecConnection(connection: Connection, nodes: ExecNode[], edges: Edge[]): ValidationResult {
  if (!connection.source || !connection.target) {
    return { valid: false, error: 'Connection endpoints are incomplete.' }
  }

  if (edges.some((edge) => isExecEdge(edge) && edge.source === connection.source && edge.target === connection.target)) {
    return { valid: false, error: 'This execution edge already exists.' }
  }

  const candidateEdges = [
    ...edges,
    {
      id: `candidate:${connection.source}:${connection.target}`,
      source: connection.source,
      target: connection.target,
      type: 'execEdge',
    } satisfies Edge,
  ]

  return validateStructuralRules(nodes, candidateEdges)
}
