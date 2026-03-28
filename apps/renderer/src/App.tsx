import { useEffect, useState, useCallback } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar, SIDEBAR_TABS, type SidebarTab } from '@/components/layout/AppSidebar'
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
import { createRequestNode, createWaitResponseNode, parseDraggedProtocolMessage } from '@/lib/protocolNodes'
import { toast } from 'sonner'
import { useTabStore } from '@/stores/tabStore'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProtoStore } from '@/stores/protoStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useExecutionStore } from '@/stores/executionStore'
import { useCollectionStore } from '@/stores/collectionStore'
import { useSessionStatusStore } from '@/stores/sessionStatusStore'
import type { SavedConnection } from '@/stores/savedConnectionStore'

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
  const [activeTab, setActiveTab] = useState<SidebarTab>(SIDEBAR_TABS.canvas)
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

  const onEmptyDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onEmptyDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const dragged = parseDraggedProtocolMessage(
      e.dataTransfer.getData('application/flow-packet-message')
    )
    if (!dragged) return

    addTab()
    const newNode = dragged.kind === 'request'
      ? createRequestNode(dragged.message, routeMappings, { x: 200, y: 150 })
      : createWaitResponseNode(dragged.message, { x: 200, y: 150 })
    addNode(newNode)
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

      setConnectionStatusCallback(() => {})

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

  const handleEnterConnection = useCallback((connection: SavedConnection) => {
    useConnectionStore.getState().setState('disconnected')
    useSessionStatusStore.getState().clearConnection(connection.id)

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
    execStore.clearNodeOutputs()
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
      connectionId: connection.id,
      protocol: connection.protocol,
      timeout: connectTimeout,
      reconnect: true,
      heartbeat: isDueProtocol,
      frameFields: connection.frameConfig?.fields,
      byteOrder: connection.frameConfig?.byteOrder,
      parserMode: connection.frameConfig?.parserMode,
    }), 10000, 'Connect request timed out').then(() => {
      useConnectionStore.getState().setState('connected')
      toast.success('Connection successful', {
        description: `Connected to ${connection.host}:${connection.port}`,
      })
    }).catch((err) => {
      useConnectionStore.getState().setState('disconnected')
      toast.error('Connection failed', {
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
    useSessionStatusStore.getState().clearAll()
  }, [setActiveConnectionId, setFiles, setMessages, setRouteMappings])

  if (!activeConnectionId) {
    return (
      <>
        <div className="flex h-svh w-full flex-col">
          <TitleBar />
          <div className="flex min-h-0 flex-1">
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
        <div className="flex h-svh w-full flex-col">
          <TitleBar />
          <div className="h-10 shrink-0 border-b border-border px-3" style={{ background: 'var(--bg-toolbar)' }}>
            <div className="flex h-full items-center">
              <Toolbar onBack={handleBackToWelcome} />
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
            <div className="min-w-0 flex-1">
              <MainLayout
                left={
                  <div className="flex h-full flex-col overflow-hidden">
                    <div className="min-h-0 flex-1 overflow-hidden">
                      {activeTab === SIDEBAR_TABS.collection ? <CollectionBrowser /> : <ProtoBrowser />}
                    </div>
                  </div>
                }
                tabs={<CanvasTabs />}
                center={
                  activeTabId ? (
                    <FlowCanvas />
                  ) : (
                    <div
                      className="flex h-full flex-col items-center justify-center text-muted-foreground"
                      onDragOver={onEmptyDragOver}
                      onDrop={onEmptyDrop}
                    >
                      <img src="./remind-2.png" alt="remind" className="-mb-7 size-32 object-contain" />
                      <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
                        Click + to create a tab, or drag in Cg / Gc messages
                      </h3>
                    </div>
                  )
                }
                bottom={<LogPanel />}
              />
            </div>
          </div>
        </div>
        <PropertySheet />
        <Toaster position="top-center" richColors />
      </SidebarProvider>
    </ReactFlowProvider>
  )
}

export default App

