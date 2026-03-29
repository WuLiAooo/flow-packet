import { Minus, Square, X, Copy } from 'lucide-react'
import { useState, useEffect } from 'react'

declare global {
  interface Window {
    flowPacket?: {
      getBackendPort: () => Promise<number>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
    }
  }
}

const isElectron = !!window.flowPacket?.windowMinimize

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!isElectron) return
    window.flowPacket?.windowIsMaximized().then(setIsMaximized)
  }, [])

  if (!isElectron) return null

  const handleMinimize = () => window.flowPacket?.windowMinimize()
  const handleMaximize = async () => {
    await window.flowPacket?.windowMaximize()
    const max = await window.flowPacket?.windowIsMaximized()
    setIsMaximized(!!max)
  }
  const handleClose = () => window.flowPacket?.windowClose()

  return (
    <div className="flex items-center h-8 shrink-0 select-none" style={{ background: 'var(--bg-toolbar)' }}>
      <div className="flex-1 h-full" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span className="text-xs text-muted-foreground leading-8 pl-3">LinkWeaver</span>
      </div>
      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="h-full w-11 flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <Minus className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full w-11 flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          {isMaximized ? (
            <Copy className="w-3.5 h-3.5 text-muted-foreground rotate-180" />
          ) : (
            <Square className="w-3 h-3 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="h-full w-11 flex items-center justify-center hover:bg-red-500 transition-colors group"
        >
          <X className="w-4 h-4 text-muted-foreground group-hover:text-white" />
        </button>
      </div>
    </div>
  )
}

