import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type ReactFlowInstance,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ColorMode, Node } from '@xyflow/react'
import { toast } from 'sonner'
import { useCanvasStore, type AnyNodeData } from '@/stores/canvasStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStatusStore } from '@/stores/sessionStatusStore'
import { useTheme } from '@/hooks/use-theme'
import { useProtoStore } from '@/stores/protoStore'
import { validateExecConnection } from '@/lib/flowGraph'
import { Button } from '@/components/ui/button'
import { parseDraggedProtocolMessage, createRequestNode, createWaitResponseNode } from '@/lib/protocolNodes'
import { BeginNode } from './nodes/BeginNode'
import { RequestNode } from './nodes/RequestNode'
import { WaitResponseNode } from './nodes/WaitResponseNode'
import { CommentNode } from './nodes/CommentNode'
import { ExecEdge } from './edges/ExecEdge'
import { CanvasControls } from './CanvasControls'
import { loginDeviceSession, logoutDeviceSession } from '@/services/api'

const nodeTypes: NodeTypes = {
  beginNode: BeginNode,
  requestNode: RequestNode,
  waitResponseNode: WaitResponseNode,
  commentNode: CommentNode,
}

const edgeTypes: EdgeTypes = {
  execEdge: ExecEdge,
}

interface NodeMenuState {
  nodeId: string
  nodeType: string
  x: number
  y: number
}

function buildBeginEdge(beginId: string, targetId: string): Edge {
  return {
    id: `begin-edge:${beginId}:${targetId}`,
    source: beginId,
    target: targetId,
    type: 'execEdge',
  }
}

export function FlowCanvas() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const updateNodes = useCanvasStore((s) => s.updateNodes)
  const updateEdges = useCanvasStore((s) => s.updateEdges)
  const setSelectedNodeId = useCanvasStore((s) => s.setSelectedNodeId)
  const addNode = useCanvasStore((s) => s.addNode)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const routeMappings = useProtoStore((s) => s.routeMappings)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const connState = useConnectionStore((s) => s.state)
  const clearSessionStatus = useSessionStatusStore((s) => s.clearStatus)
  const getSessionStatus = useSessionStatusStore((s) => s.getStatus)
  const theme = useTheme((s) => s.theme)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const reactFlowInstance = useRef<ReactFlowInstance<Node<AnyNodeData>> | null>(null)

  const [drawingComment, setDrawingComment] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
  const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null)

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      updateNodes((nds) => applyNodeChanges(changes, nds) as Node<AnyNodeData>[])
    },
    [updateNodes],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      updateEdges((eds) => applyEdgeChanges(changes, eds))
    },
    [updateEdges],
  )

  const takeSnapshot = useCanvasStore((s) => s.takeSnapshot)

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      const validation = validateExecConnection(connection, nodes, edges)
      if (!validation.valid) {
        toast.error('Invalid connection', {
          description: validation.error,
        })
        return
      }

      takeSnapshot()
      updateEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'execEdge',
          },
          eds,
        ),
      )
    },
    [edges, nodes, takeSnapshot, updateEdges],
  )

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setNodeMenu(null)
      setSelectedNodeId(node.id)
    },
    [setSelectedNodeId],
  )

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.type !== 'requestNode' && node.type !== 'beginNode') {
        setNodeMenu(null)
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setSelectedNodeId(node.id)
      setNodeMenu({
        nodeId: node.id,
        nodeType: node.type ?? '',
        x: event.clientX,
        y: event.clientY,
      })
    },
    [setSelectedNodeId],
  )

  const handleSetAsBegin = useCallback(() => {
    if (!nodeMenu) return

    const beginNode = nodes.find((node) => node.type === 'beginNode')
    if (!beginNode) {
      setNodeMenu(null)
      toast.error('Begin node is missing')
      return
    }

    const nextTargetId = nodeMenu.nodeId
    const currentEdge = edges.find((edge) => edge.type === 'execEdge' && edge.source === beginNode.id)
    if (currentEdge?.target === nextTargetId) {
      setNodeMenu(null)
      return
    }

    takeSnapshot()
    updateEdges((currentEdges) => {
      const withoutBeginEdges = currentEdges.filter(
        (edge) => !(edge.type === 'execEdge' && edge.source === beginNode.id),
      )
      return [...withoutBeginEdges, buildBeginEdge(beginNode.id, nextTargetId)]
    })
    setNodeMenu(null)
    toast.success('Begin target updated')
  }, [edges, nodeMenu, nodes, takeSnapshot, updateEdges])

  const handleBeginLogin = useCallback(async () => {
    if (!nodeMenu || nodeMenu.nodeType !== 'beginNode') return
    if (!activeConnectionId) {
      setNodeMenu(null)
      toast.error('No active connection')
      return
    }
    if (connState !== 'connected') {
      setNodeMenu(null)
      toast.error('Connection unavailable', {
        description: 'Connect to the server first before logging in this BeginNode.',
      })
      return
    }

    const beginNode = nodes.find((node) => node.id === nodeMenu.nodeId && node.type === 'beginNode')
    const deviceId = typeof beginNode?.data?.deviceId === 'string' ? beginNode.data.deviceId.trim() : ''
    if (!deviceId) {
      setNodeMenu(null)
      toast.error('Begin deviceId required', {
        description: 'Double-click BeginNode and configure the deviceId before login.',
      })
      return
    }

    clearSessionStatus(activeConnectionId, deviceId)

    try {
      await loginDeviceSession(activeConnectionId, deviceId)
      toast.success('Begin session ready', {
        description: `deviceId: ${deviceId}`,
      })
    } catch (err) {
      toast.error('Begin login failed', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setNodeMenu(null)
    }
  }, [activeConnectionId, clearSessionStatus, connState, nodeMenu, nodes])

  const handleBeginLogout = useCallback(async () => {
    if (!nodeMenu || nodeMenu.nodeType !== 'beginNode') return
    if (!activeConnectionId) {
      setNodeMenu(null)
      toast.error('No active connection')
      return
    }

    const beginNode = nodes.find((node) => node.id === nodeMenu.nodeId && node.type === 'beginNode')
    const deviceId = typeof beginNode?.data?.deviceId === 'string' ? beginNode.data.deviceId.trim() : ''
    if (!deviceId) {
      setNodeMenu(null)
      toast.error('Begin deviceId required')
      return
    }

    try {
      await logoutDeviceSession(activeConnectionId, deviceId)
      toast.success('Begin session logged out', {
        description: `deviceId: ${deviceId}`,
      })
    } catch (err) {
      toast.error('Begin logout failed', {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setNodeMenu(null)
    }
  }, [activeConnectionId, nodeMenu, nodes])
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      useCanvasStore.getState().setEditingNodeId(node.id)
    },
    [],
  )

  const onPaneClick = useCallback(() => {
    setNodeMenu(null)
    setSelectedNodeId(null)
    useCanvasStore.getState().setEditingNodeId(null)
  }, [setSelectedNodeId])

  const onNodeDragStart = useCallback(() => {
    setNodeMenu(null)
    takeSnapshot()
  }, [takeSnapshot])

  const onNodeDragStop = useCallback(() => {
    setSelectedNodeId(null)
    updateNodes((nds) => nds.map((node) => ({ ...node, selected: false })))
  }, [setSelectedNodeId, updateNodes])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedId = useCanvasStore.getState().selectedNodeId
        if (selectedId) {
          removeNode(selectedId)
        }
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (e.shiftKey) {
          useCanvasStore.getState().redo()
        } else {
          useCanvasStore.getState().undo()
        }
      }
    },
    [removeNode],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()

      const dragged = parseDraggedProtocolMessage(
        e.dataTransfer.getData('application/flow-packet-message'),
      )
      if (!dragged) return

      const instance = reactFlowInstance.current
      if (!instance) return

      const position = instance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      })

      const newNode = dragged.kind === 'request'
        ? createRequestNode(dragged.message, routeMappings, position)
        : createWaitResponseNode(dragged.message, position)

      addNode(newNode)
    },
    [addNode, routeMappings],
  )

  const onWrapperMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.ctrlKey && e.button === 0) {
        e.stopPropagation()
        const instance = reactFlowInstance.current
        if (!instance) return
        const flowPos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        setDrawStart(flowPos)
        setDrawCurrent(flowPos)
        setDrawingComment(true)
      }
    },
    [],
  )

  const onWrapperMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!drawingComment) return
      const instance = reactFlowInstance.current
      if (!instance) return
      const flowPos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setDrawCurrent(flowPos)
    },
    [drawingComment],
  )

  const onWrapperMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!drawingComment || !drawStart || !drawCurrent) return
      e.stopPropagation()

      const x = Math.min(drawStart.x, drawCurrent.x)
      const y = Math.min(drawStart.y, drawCurrent.y)
      const w = Math.max(200, Math.abs(drawCurrent.x - drawStart.x))
      const h = Math.max(80, Math.abs(drawCurrent.y - drawStart.y))

      const newNode: Node<AnyNodeData> = {
        id: `comment_${Date.now()}`,
        type: 'commentNode',
        position: { x, y },
        style: { width: w, height: h },
        zIndex: -1,
        data: {
          label: 'Note',
          color: '#9B8E7B',
        },
      }

      addNode(newNode)
      setDrawingComment(false)
      setDrawStart(null)
      setDrawCurrent(null)
    },
    [drawingComment, drawStart, drawCurrent, addNode],
  )

  useEffect(() => {
    if (!nodeMenu) return

    const handleWindowClick = () => setNodeMenu(null)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNodeMenu(null)
    }

    window.addEventListener('click', handleWindowClick)
    window.addEventListener('contextmenu', handleWindowClick)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('click', handleWindowClick)
      window.removeEventListener('contextmenu', handleWindowClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [nodeMenu])

  const beginMenuNode = nodeMenu?.nodeType === 'beginNode'
    ? nodes.find((node) => node.id === nodeMenu.nodeId && node.type === 'beginNode')
    : undefined
  const beginMenuDeviceId = typeof beginMenuNode?.data?.deviceId === 'string' ? beginMenuNode.data.deviceId.trim() : ''
  const beginMenuSessionState = activeConnectionId && beginMenuDeviceId
    ? getSessionStatus(activeConnectionId, beginMenuDeviceId)?.state
    : undefined
  const beginMenuActionLabel = beginMenuSessionState === 'ready' ? 'Logout' : 'Login'

  let previewRect: { left: number; top: number; width: number; height: number } | null = null
  if (drawingComment && drawStart && drawCurrent) {
    const instance = reactFlowInstance.current
    if (instance) {
      const startScreen = instance.flowToScreenPosition(drawStart)
      const currentScreen = instance.flowToScreenPosition(drawCurrent)
      const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect()
      if (wrapperBounds) {
        const left = Math.min(startScreen.x, currentScreen.x) - wrapperBounds.left
        const top = Math.min(startScreen.y, currentScreen.y) - wrapperBounds.top
        const width = Math.abs(currentScreen.x - startScreen.x)
        const height = Math.abs(currentScreen.y - startScreen.y)
        previewRect = { left, top, width, height }
      }
    }
  }

  return (
    <div
      ref={reactFlowWrapper}
      className="relative h-full w-full"
      onKeyDown={onKeyDown}
      onMouseDown={onWrapperMouseDown}
      onMouseMove={onWrapperMouseMove}
      onMouseUp={onWrapperMouseUp}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => { reactFlowInstance.current = instance }}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={theme as ColorMode}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2.0}
        defaultEdgeOptions={{ type: 'execEdge' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#62748e"
          className="dark:!bg-background"
        />
        <MiniMap
          nodeStrokeWidth={4}
          maskStrokeColor={theme === 'dark' ? '#FFFFFF1A' : '#e2e8f0'}
          maskColor={theme === 'dark' ? '#21262d77' : '#62748e05'}
          maskStrokeWidth={1}
          nodeClassName="!fill-muted-foreground/20"
          className="!overflow-hidden rounded-lg border !bg-background"
        />
        <CanvasControls />
      </ReactFlow>
      {nodeMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-lg"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {nodeMenu.nodeType === 'requestNode' && (
            <Button
              variant="ghost"
              className="h-8 w-full justify-start px-2 text-sm"
              onClick={handleSetAsBegin}
            >
              Set as Begin
            </Button>
          )}
          {nodeMenu.nodeType === 'beginNode' && (
            <Button
              variant="ghost"
              className="h-8 w-full justify-start px-2 text-sm"
              onClick={() => void (beginMenuSessionState === 'ready' ? handleBeginLogout() : handleBeginLogin())}
            >
              {beginMenuActionLabel}
            </Button>
          )}
        </div>
      )}
      {previewRect && (
        <div
          className="pointer-events-none absolute rounded-[12px] border-2 border-[#9B8E7B]"
          style={{
            left: previewRect.left,
            top: previewRect.top,
            width: previewRect.width,
            height: previewRect.height,
            background: '#9B8E7B1A',
          }}
        />
      )}
    </div>
  )
}







