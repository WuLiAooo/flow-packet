import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar, SIDEBAR_TABS, type SidebarTab } from '@/components/layout/AppSidebar'
import { TitleBar } from '@/components/layout/TitleBar'
import { WelcomePage } from '@/components/connection/WelcomePage'
import { initEventBindings } from '@/services/eventBindings'
import { connect as wsConnect, sendRequest, setConnectionStatusCallback } from '@/services/ws'
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

const loadMainLayout = () => import('@/components/layout/MainLayout')
const loadCanvasTabs = () => import('@/components/layout/CanvasTabs')
const loadToolbar = () => import('@/components/layout/Toolbar')
const loadProtoBrowser = () => import('@/components/proto/ProtoBrowser')
const loadCollectionBrowser = () => import('@/components/collection/CollectionBrowser')
const loadFlowCanvas = () => import('@/components/canvas/FlowCanvas')
const loadPropertySheet = () => import('@/components/editor/PropertySheet')
const loadLogPanel = () => import('@/components/execution/LogPanel')

const MainLayout = lazy(() => loadMainLayout().then((module) => ({ default: module.MainLayout })))
const CanvasTabs = lazy(() => loadCanvasTabs().then((module) => ({ default: module.CanvasTabs })))
const Toolbar = lazy(() => loadToolbar().then((module) => ({ default: module.Toolbar })))
const ProtoBrowser = lazy(() => loadProtoBrowser().then((module) => ({ default: module.ProtoBrowser })))
const CollectionBrowser = lazy(() => loadCollectionBrowser().then((module) => ({ default: module.CollectionBrowser })))
const FlowCanvas = lazy(() => loadFlowCanvas().then((module) => ({ default: module.FlowCanvas })))
const PropertySheet = lazy(() => loadPropertySheet().then((module) => ({ default: module.PropertySheet })))
const LogPanel = lazy(() => loadLogPanel().then((module) => ({ default: module.LogPanel })))

function preloadWorkspaceModules() {
  return Promise.allSettled([
    loadMainLayout(),
    loadCanvasTabs(),
    loadToolbar(),
    loadProtoBrowser(),
    loadCollectionBrowser(),
    loadFlowCanvas(),
    loadPropertySheet(),
    loadLogPanel(),
  ])
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
    const timer = window.setTimeout(() => reject(new Error(message)) , timeoutMs)
    promise.then((value) => {
      window.clearTimeout(timer)
      resolve(value)
    }).catch((err) => {
      window.clearTimeout(timer)
      reject(err)
    })
  })
}

function WorkspaceFallback() {
  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-canvas)' }}>
      <div className="h-10 shrink-0 border-b border-border px-3" style={{ background: 'var(--bg-toolbar)' }} />
      <div className="flex min-h-0 flex-1">
        <div className="w-12 shrink-0 border-r border-border" style={{ background: 'var(--bg-activity)' }} />
        <div className="min-w-0 flex-1" style={{ background: 'var(--bg-canvas)' }} />
      </div>
    </div>
  )
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
    let schemaWarmupTimer: ReturnType<typeof setTimeout> | null = null
    let workspacePreloadTimer: ReturnType<typeof setTimeout> | null = null
    let schemaWarmupCompleted = false
    let schemaWarmupInFlight = false
    let workspacePreloaded = false
    let workspacePreloadInFlight = false

    const runWorkspacePreload = () => {
      if (workspacePreloaded || workspacePreloadInFlight) {
        return
      }
      workspacePreloadInFlight = true
      preloadWorkspaceModules()
        .then(() => {
          workspacePreloaded = true
        })
        .finally(() => {
          workspacePreloadInFlight = false
        })
    }

    const scheduleSchemaWarmup = () => {
      if (schemaWarmupCompleted || schemaWarmupInFlight) {
        return
      }
      if (schemaWarmupTimer) {
        window.clearTimeout(schemaWarmupTimer)
      }
      schemaWarmupTimer = window.setTimeout(() => {
        schemaWarmupTimer = null
        schemaWarmupInFlight = true
        sendRequest('schema.warmup')
          .then(() => {
            schemaWarmupCompleted = true
          })
          .catch(() => {})
          .finally(() => {
            schemaWarmupInFlight = false
          })
      }, 1500)
    }

    workspacePreloadTimer = window.setTimeout(() => {
      workspacePreloadTimer = null
      runWorkspacePreload()
    }, 1500)

    const initBackend = async () => {
      let port: number | null = 58996
      const fp = (window as { flowPacket?: { getBackendPort: () => Promise<number> } }).flowPacket
      if (fp) {
        try {
          const resolvedPort = await fp.getBackendPort()
          port = typeof resolvedPort === 'number' && Number.isFinite(resolvedPort) && resolvedPort > 0
            ? resolvedPort
            : null
        } catch {
          port = null
        }
      }

      if (port === null) {
        return
      }

      setConnectionStatusCallback((connected) => {
        if (!connected) {
          if (schemaWarmupTimer) {
            window.clearTimeout(schemaWarmupTimer)
            schemaWarmupTimer = null
          }
          return
        }
        scheduleSchemaWarmup()
      })

      ;(window as { __BACKEND_PORT__?: number }).__BACKEND_PORT__ = port
      wsConnect(port)
    }

    initBackend()

    return () => {
      if (schemaWarmupTimer) {
        window.clearTimeout(schemaWarmupTimer)
      }
      if (workspacePreloadTimer) {
        window.clearTimeout(workspacePreloadTimer)
      }
      setConnectionStatusCallback(() => {})
      cleanup()
    }
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
    void preloadWorkspaceModules()

    useConnectionStore.getState().setState('disconnected')
    useSessionStatusStore.getState().clearConnection(connection.id)

    setConfig({
      host: connection.host,
      port: connection.port,
      protocol: connection.protocol,
    })
    setTargetAddr(`${connection.host}:${connection.port}`)

    const routeFields = connection.frameConfig?.fields.filter((f) => f.isRoute) ?? []
    setRouteFields(routeFields)

    const execStore = useExecutionStore.getState()
    execStore.clearLogs()
    execStore.resetNodeStatuses()
    execStore.clearNodeOutputs()
    execStore.setStatus('idle')

    useTabStore.getState().loadConnectionTabs(connection.id)
    setActiveConnectionId(connection.id)
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
    if (activeConnectionId) {
      useTabStore.getState().persistTabsForConnection(activeConnectionId)
    }
    setFiles([])
    setMessages([])
    setRouteMappings([])
    setActiveConnectionId(null)
    useCollectionStore.getState().clearCollections()
    useSessionStatusStore.getState().clearAll()
  }, [activeConnectionId, setActiveConnectionId, setFiles, setMessages, setRouteMappings])

  return (
    <ReactFlowProvider>
      <SidebarProvider open={false} onOpenChange={() => {}}>
        <div className="flex h-svh w-full flex-col" style={{ background: 'var(--bg-canvas)' }}>
          <TitleBar />
          {activeConnectionId ? (
            <Suspense fallback={<WorkspaceFallback />}>
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

              <PropertySheet />
            </Suspense>
          ) : (
            <div className="flex min-h-0 flex-1">
              <WelcomePage onEnterConnection={handleEnterConnection} />
            </div>
          )}
        </div>
        <Toaster position="top-center" richColors />
      </SidebarProvider>
    </ReactFlowProvider>
  )
}

export default App
