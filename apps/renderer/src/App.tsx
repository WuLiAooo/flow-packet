import { useEffect, useState, useCallback } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar, type SidebarTab } from '@/components/layout/AppSidebar'
import { MainLayout } from '@/components/layout/MainLayout'
import { CanvasTabs } from '@/components/layout/CanvasTabs'
import { Toolbar } from '@/components/layout/Toolbar'
import { TitleBar } from '@/components/layout/TitleBar'
import { ProtoBrowser } from '@/components/proto/ProtoBrowser'
import { CollectionBrowser } from '@/components/collection/CollectionBrowser'
import { FlowCanvas } from '@/components/canvas/FlowCanvas'
import { PropertySheet } from '@/components/editor/PropertySheet'
import { LogPanel } from '@/components/execution/LogPanel'
import { WelcomePage } from '@/components/connection/WelcomePage'
import { initEventBindings } from '@/services/eventBindings'
import { connect as wsConnect, setConnectionStatusCallback } from '@/services/ws'
import { connectTCP, getProtoList, getRouteList } from '@/services/api'
import { toast } from 'sonner'
import { useTabStore } from '@/stores/tabStore'
import { useCanvasStore, type RequestNodeData } from '@/stores/canvasStore'
import { useProtoStore } from '@/stores/protoStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useExecutionStore } from '@/stores/executionStore'
import { useCollectionStore } from '@/stores/collectionStore'
import type { SavedConnection } from '@/stores/savedConnectionStore'

interface DebugInfo {
  bodyPointerEvents: string
  bodyOverflow: string
  bodyScrollLocked: string
  dialogOverlays: number
  alertOverlays: number
  topElement: string
}

function unlockBodyInteraction() {
  document.body.style.pointerEvents = ''
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
  document.body.removeAttribute('data-scroll-locked')
}

function cleanupTransientPortals() {
  document
    .querySelectorAll(
      '[data-slot="dialog-overlay"], [data-slot="dialog-portal"], [data-slot="alert-dialog-overlay"], [data-slot="alert-dialog-portal"]'
    )
    .forEach((node) => node.remove())
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then((value) => {
      window.clearTimeout(timer)
      resolve(value)
    }).catch((err) => {
      window.clearTimeout(timer)
      reject(err)
    })
  })
}

function App() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('画布')
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const setActiveConnectionId = useConnectionStore((s) => s.setActiveConnectionId)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const addTab = useTabStore((s) => s.addTab)
  const addNode = useCanvasStore((s) => s.addNode)
  const routeMappings = useProtoStore((s) => s.routeMappings)
  const setFiles = useProtoStore((s) => s.setFiles)
  const setMessages = useProtoStore((s) => s.setMessages)
  const setRouteMappings = useProtoStore((s) => s.setRouteMappings)
  const setConfig = useConnectionStore((s) => s.setConfig)
  const setRouteFields = useConnectionStore((s) => s.setRouteFields)
  const setTargetAddr = useConnectionStore((s) => s.setTargetAddr)
  const connState = useConnectionStore((s) => s.state)
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    bodyPointerEvents: '',
    bodyOverflow: '',
    bodyScrollLocked: '',
    dialogOverlays: 0,
    alertOverlays: 0,
    topElement: '',
  })

  const onEmptyDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onEmptyDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const data = e.dataTransfer.getData('application/flow-packet-message')
    if (!data) return

    try {
      const message = JSON.parse(data)
      const mapping = routeMappings.find((m) => m.requestMsg === message.Name)
      addTab()

      const newNode: Node<RequestNodeData> = {
        id: `node_${Date.now()}`,
        type: 'requestNode',
        position: { x: 200, y: 150 },
        data: {
          messageName: message.Name,
          route: mapping?.route ?? 0,
          stringRoute: mapping?.stringRoute,
          fields: {},
          responseFields: message.Fields?.map((f: { name: string; type: string }) => ({
            name: f.name,
            type: f.type,
          })),
        },
      }

      addNode(newNode)
    } catch {
      // ignore
    }
  }, [addTab, addNode, routeMappings])

  useEffect(() => {
    const cleanup = initEventBindings()

    const initBackend = async () => {
      let port = 58996
      const fp = (window as { flowPacket?: { getBackendPort: () => Promise<number> } }).flowPacket
      if (fp) {
        try {
          port = await fp.getBackendPort()
        } catch {
          // fallback to default
        }
      }

      setConnectionStatusCallback((connected) => {
        if (connected) {
          console.log('[ws] connected to backend')
        }
      })

      ;(window as { __BACKEND_PORT__?: number }).__BACKEND_PORT__ = port
      wsConnect(port)
    }

    initBackend()

    return cleanup
  }, [])

  useEffect(() => {
    if (!activeConnectionId) return

    unlockBodyInteraction()
    cleanupTransientPortals()

    const timer = window.setInterval(() => {
      unlockBodyInteraction()
      cleanupTransientPortals()
    }, 200)

    const stopTimer = window.setTimeout(() => {
      window.clearInterval(timer)
    }, 3000)

    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stopTimer)
    }
  }, [activeConnectionId])

  useEffect(() => {
    const updateDebugInfo = () => {
      const centerX = Math.max(0, Math.floor(window.innerWidth / 2))
      const centerY = Math.max(0, Math.floor(window.innerHeight / 2))
      const top = document.elementFromPoint(centerX, centerY)

      setDebugInfo({
        bodyPointerEvents: document.body.style.pointerEvents || '(empty)',
        bodyOverflow: document.body.style.overflow || '(empty)',
        bodyScrollLocked: document.body.getAttribute('data-scroll-locked') || '(none)',
        dialogOverlays: document.querySelectorAll('[data-slot="dialog-overlay"], [data-slot="dialog-portal"]').length,
        alertOverlays: document.querySelectorAll('[data-slot="alert-dialog-overlay"], [data-slot="alert-dialog-portal"]').length,
        topElement: top instanceof HTMLElement
          ? `${top.tagName.toLowerCase()}.${top.className || '(no-class)'}`
          : '(none)',
      })
    }

    updateDebugInfo()
    const timer = window.setInterval(updateDebugInfo, 300)
    return () => window.clearInterval(timer)
  }, [activeConnectionId, connState])

  const handleEnterConnection = useCallback((connection: SavedConnection) => {
    useConnectionStore.getState().setState('disconnected')

    setConfig({
      host: connection.host,
      port: connection.port,
      protocol: connection.protocol,
    })
    setTargetAddr(`${connection.host}:${connection.port}`)
    setActiveConnectionId(connection.id)

    const routeFields = connection.frameConfig?.fields.filter((f) => f.isRoute) ?? []
    setRouteFields(routeFields)

    const execStore = useExecutionStore.getState()
    execStore.clearLogs()
    execStore.resetNodeStatuses()
    execStore.setStatus('idle')

    useTabStore.getState().resetTabs()
    useCollectionStore.getState().loadCollections(connection.id).catch(() => {})

    getProtoList(connection.id).then((result: unknown) => {
      const r = result as { files?: unknown[]; messages?: unknown[] }
      setFiles((r.files ?? []) as import('@/stores/protoStore').FileInfo[])
      setMessages((r.messages ?? []) as import('@/stores/protoStore').MessageInfo[])
    }).catch(() => {})

    getRouteList(connection.id).then((result: unknown) => {
      const r = result as { routes?: unknown[] }
      setRouteMappings((r.routes ?? []) as import('@/stores/protoStore').RouteMapping[])
    }).catch(() => {})

    const isDueProtocol = connection.frameConfig?.fields?.some(
      (f) => f.name.toLowerCase() === 'header' && f.bytes === 1
    ) ?? false
    const connectTimeout = useConnectionStore.getState().config.timeout || 5000

    useConnectionStore.getState().setState('connecting')
    withTimeout(connectTCP(connection.host, connection.port, {
      protocol: connection.protocol,
      timeout: connectTimeout,
      reconnect: true,
      heartbeat: isDueProtocol,
      frameFields: connection.frameConfig?.fields,
      byteOrder: connection.frameConfig?.byteOrder,
      parserMode: connection.frameConfig?.parserMode,
    }), 10000, 'Connect request timed out').then(() => {
      useConnectionStore.getState().setState('connected')
      toast.success('连接成功', {
        description: `已连接到 ${connection.host}:${connection.port}`,
      })
    }).catch((err) => {
      useConnectionStore.getState().setState('disconnected')
      toast.error('连接失败', {
        description: err instanceof Error ? err.message : String(err),
      })
    })
  }, [setActiveConnectionId, setConfig, setFiles, setMessages, setRouteFields, setRouteMappings, setTargetAddr])

  const handleBackToWelcome = useCallback(() => {
    setFiles([])
    setMessages([])
    setRouteMappings([])
    setActiveConnectionId(null)
    useTabStore.getState().resetTabs()
    useCollectionStore.getState().clearCollections()
  }, [setActiveConnectionId, setFiles, setMessages, setRouteMappings])

  if (!activeConnectionId) {
    return (
      <>
        <div className="flex h-svh w-full flex-col">
          <TitleBar />
          <div className="flex flex-1 min-h-0">
            <WelcomePage onEnterConnection={handleEnterConnection} />
          </div>
        </div>
        <Toaster position="top-center" richColors />
      </>
    )
  }

  return (
    <ReactFlowProvider>
      <SidebarProvider open={false} onOpenChange={() => {}}>
        <div className="flex h-svh flex-col w-full">
          <TitleBar />
          <div className="flex items-center h-10 px-3 shrink-0 border-b border-border" style={{ background: 'var(--bg-toolbar)' }}>
            <Toolbar onBack={handleBackToWelcome} />
          </div>

          <div className="flex flex-1 min-h-0">
            <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="flex-1 min-w-0">
              <MainLayout
                left={
                  <div className="flex flex-col h-full overflow-hidden">
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {activeTab === '集合' ? <CollectionBrowser /> : <ProtoBrowser />}
                    </div>
                  </div>
                }
                tabs={<CanvasTabs />}
                center={
                  activeTabId ? (
                    <FlowCanvas />
                  ) : (
                    <div
                      className="flex flex-col items-center justify-center h-full text-muted-foreground"
                      onDragOver={onEmptyDragOver}
                      onDrop={onEmptyDrop}
                    >
                      <img src="./remind-2.png" alt="remind" className="size-32 -mb-7 object-contain" />
                      <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
                        点击 + 新建页签，或拖入消息
                      </h3>
                    </div>
                  )
                }
                bottom={<LogPanel />}
              />
            </div>
          </div>
        </div>
        <div className="pointer-events-none fixed right-2 bottom-2 z-[9999] max-w-[460px] rounded border bg-background/95 px-3 py-2 font-mono text-[11px] shadow-lg">
          <div>state: {connState}</div>
          <div>body.pointerEvents: {debugInfo.bodyPointerEvents}</div>
          <div>body.overflow: {debugInfo.bodyOverflow}</div>
          <div>body.scrollLocked: {debugInfo.bodyScrollLocked}</div>
          <div>dialogOverlays: {debugInfo.dialogOverlays}</div>
          <div>alertOverlays: {debugInfo.alertOverlays}</div>
          <div>topAtCenter: {debugInfo.topElement}</div>
        </div>
        <PropertySheet />
        <Toaster position="top-center" richColors />
      </SidebarProvider>
    </ReactFlowProvider>
  )
}

export default App
