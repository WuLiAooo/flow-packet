import type { Connection, Edge, Node } from '@xyflow/react'
import type { AnyNodeData } from '@/stores/canvasStore'

type FlowNode = Node<AnyNodeData>
type FlowNodeType = 'beginNode' | 'requestNode' | 'waitResponseNode'
export type WaitNodeMode = 'continue' | 'observe' | 'standalone'

interface ValidationResult {
  valid: boolean
  error?: string
  details?: string[]
}

interface RequestTargets {
  directRequestTargets: string[]
  continuingWaitTargets: string[]
  plainWaitTargets: string[]
}

interface ExecutableFlowResult {
  validation: ValidationResult
  nodes: FlowNode[]
  edges: Edge[]
}

function isExecEdge(edge: Edge): boolean {
  return edge.type === 'execEdge'
}

function isFlowNodeType(type: string | undefined): type is FlowNodeType {
  return type === 'beginNode' || type === 'requestNode' || type === 'waitResponseNode'
}

function buildNodeMap(nodes: FlowNode[]): Map<string, FlowNode> {
  return new Map(
    nodes.filter((node) => isFlowNodeType(node.type)).map((node) => [node.id, node]),
  )
}

function buildAdjacency(nodes: FlowNode[], edges: Edge[]) {
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

function getNodeLabel(nodeId: string, nodeMap: Map<string, FlowNode>): string {
  const node = nodeMap.get(nodeId)
  if (!node) return nodeId

  if (node.type === 'beginNode') return 'Begin'

  const messageName = typeof node.data?.messageName === 'string' ? node.data.messageName : nodeId
  const shortName = messageName.split('.').pop() || messageName
  return `${shortName} (${nodeId})`
}


function getBeginNode(nodeMap: Map<string, FlowNode>): FlowNode | undefined {
  return [...nodeMap.values()].find((node) => node.type === 'beginNode')
}

function getRequestTargets(
  requestId: string,
  nodeMap: Map<string, FlowNode>,
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

    if (target.type !== 'waitResponseNode') continue

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
  nodeMap: Map<string, FlowNode>,
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

function validateStructuralRules(nodes: FlowNode[], edges: Edge[]): ValidationResult {
  const { nodeMap, execEdges, incoming, outgoing } = buildAdjacency(nodes, edges)

  const beginNodes = [...nodeMap.values()].filter((node) => node.type === 'beginNode')
  if (beginNodes.length !== 1) {
    return {
      valid: false,
      error: 'Canvas must contain exactly one Begin node.',
      details: beginNodes.map((node) => node.id),
    }
  }

  for (const edge of execEdges) {
    if (edge.source === edge.target) {
      return { valid: false, error: 'A node cannot connect to itself.' }
    }

    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue

    if (source.type === 'beginNode' && target.type !== 'requestNode') {
      return { valid: false, error: 'Begin can only connect to a Cg node.' }
    }
    if (target.type === 'beginNode') {
      return { valid: false, error: 'No node can connect into Begin.' }
    }
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

    if (node.type === 'beginNode') {
      if (nodeIncoming.length > 0) {
        return { valid: false, error: 'Begin cannot have incoming connections.' }
      }
      if (nodeOutgoing.length > 1) {
        return { valid: false, error: 'Begin can only select one executable chain.' }
      }
      continue
    }

    if (node.type === 'requestNode') {
      if (nodeIncoming.length > 1) {
        return {
          valid: false,
          error: 'A Cg node can only have one incoming execution path.',
          details: [getNodeLabel(nodeId, nodeMap)],
        }
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
      continue
    }

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

function collectReachableFromBegin(nodes: FlowNode[], edges: Edge[]): ExecutableFlowResult {
  const structural = validateStructuralRules(nodes, edges)
  if (!structural.valid) {
    return { validation: structural, nodes: [], edges: [] }
  }

  const { nodeMap, execEdges, outgoing } = buildAdjacency(nodes, edges)
  const begin = getBeginNode(nodeMap)
  if (!begin) {
    return {
      validation: { valid: false, error: 'Begin node is missing.' },
      nodes: [],
      edges: [],
    }
  }

  const beginTargets = outgoing.get(begin.id) ?? []
  if (beginTargets.length === 0) {
    return {
      validation: { valid: false, error: 'Begin is not connected to any Cg node.' },
      nodes: [],
      edges: [],
    }
  }

  const reachable = new Set<string>()
  const visiting = new Set<string>()
  let cycleAt: string | null = null

  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      cycleAt = nodeId
      return
    }
    if (reachable.has(nodeId) || cycleAt) return

    visiting.add(nodeId)
    reachable.add(nodeId)
    for (const nextId of outgoing.get(nodeId) ?? []) {
      visit(nextId)
      if (cycleAt) return
    }
    visiting.delete(nodeId)
  }

  visit(begin.id)

  if (cycleAt) {
    return {
      validation: {
        valid: false,
        error: `The selected chain contains a cycle at ${getNodeLabel(cycleAt, nodeMap)}.`,
      },
      nodes: [],
      edges: [],
    }
  }

  const selectedNodes = [...nodeMap.values()].filter(
    (node) => reachable.has(node.id) && node.type !== 'beginNode',
  )
  const selectedNodeIds = new Set(selectedNodes.map((node) => node.id))
  const selectedEdges = execEdges.filter(
    (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
  )

  if (selectedNodes.length === 0) {
    return {
      validation: { valid: false, error: 'Begin does not point to an executable chain.' },
      nodes: [],
      edges: [],
    }
  }

  return {
    validation: { valid: true },
    nodes: selectedNodes,
    edges: selectedEdges,
  }
}

function validateSelectedExecutableSubgraph(nodes: FlowNode[], edges: Edge[]): ValidationResult {
  const { nodeMap, incoming, outgoing } = buildAdjacency(nodes, edges)
  if (nodeMap.size === 0) {
    return { valid: false, error: 'Begin does not point to an executable chain.' }
  }

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
      return {
        valid: false,
        error: 'A Cg node cannot have multiple incoming execution paths.',
        details: [getNodeLabel(targetId, nodeMap)],
      }
    }
    indegree.set(targetId, nextDegree)
  }

  const starts = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([nodeId]) => nodeId)
  if (starts.length !== 1) {
    return { valid: false, error: 'Begin must point to exactly one executable chain.' }
  }

  return { valid: true }
}

export function getWaitNodeMode(nodeId: string, nodes: FlowNode[], edges: Edge[]): WaitNodeMode {
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

export function validateFlowGraph(nodes: FlowNode[], edges: Edge[]): ValidationResult {
  const selected = collectReachableFromBegin(nodes, edges)
  if (!selected.validation.valid) {
    return selected.validation
  }

  return validateSelectedExecutableSubgraph(selected.nodes, selected.edges)
}

export function getExecutableFlowFromBegin(nodes: FlowNode[], edges: Edge[]): ExecutableFlowResult {
  const selected = collectReachableFromBegin(nodes, edges)
  if (!selected.validation.valid) {
    return selected
  }

  const validation = validateSelectedExecutableSubgraph(selected.nodes, selected.edges)
  if (!validation.valid) {
    return { validation, nodes: [], edges: [] }
  }

  return selected
}

export function formatValidationMessage(result: ValidationResult): string {
  if (result.valid) return ''
  if (!result.details || result.details.length === 0) {
    return result.error ?? 'Flow validation failed.'
  }

  const preview = result.details.slice(0, 5)
  const suffix = result.details.length > preview.length
    ? `, and ${result.details.length - preview.length} more`
    : ''

  return `${result.error} Affected nodes: ${preview.join(', ')}${suffix}.`
}

export function validateExecConnection(connection: Connection, nodes: FlowNode[], edges: Edge[]): ValidationResult {
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

