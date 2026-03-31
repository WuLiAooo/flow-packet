import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'

// 绂佺敤 GPU 纭欢鍔犻€燂紝淇 Windows 鏃犺竟妗嗙獥鍙ｄ笅鐢诲竷鎷栨嫿鍜岃繛绾跨殑娓叉煋娈嬪奖闂
app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null
let goProcess: ChildProcess | null = null
let backendPort: number | null = null
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const isDevMode = !app.isPackaged
const BACKEND_STARTUP_TIMEOUT_MS = 30000

function getDevBackendDir(): string {
  return path.join(__dirname, '..', '..', 'server', 'cmd', 'flow-packet')
}

function getGoCommand(): string {
  const executable = process.platform === 'win32' ? 'go.exe' : 'go'
  const candidates = [
    process.env.GO_EXECUTABLE,
    process.env.GOROOT ? path.join(process.env.GOROOT, 'bin', executable) : undefined,
    process.platform === 'win32' ? 'C:\\Program Files\\Go\\bin\\go.exe' : '/usr/local/go/bin/go',
    'go',
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (candidate === 'go') {
      return candidate
    }
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return 'go'
}

function getGoExecutablePath(): string {
  if (isDevMode) {
    // 寮€鍙戞ā寮忥細浣跨敤 go run 鎴栭缂栬瘧鐨勪簩杩涘埗
    return getDevBackendDir()
  }
  // 鐢熶骇妯″紡锛氭墦鍖呯殑浜岃繘鍒舵枃浠?
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(process.resourcesPath, 'go-backend', `flow-packet${ext}`)
}

function startGoBackend(): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        reject(new Error(`Go backend startup timeout (${BACKEND_STARTUP_TIMEOUT_MS / 1000}s)`))
      }
    }, BACKEND_STARTUP_TIMEOUT_MS)

    let cmd: string
    let args: string[]

    if (isDevMode) {
      cmd = getGoCommand()
      args = ['run', '.']
    } else {
      cmd = getGoExecutablePath()
      args = []
    }

    const cwd = isDevMode ? getDevBackendDir() : undefined

    goProcess = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    goProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      const match = output.match(/PORT:(\d+)/)
      if (match) {
        const port = parseInt(match[1])
        backendPort = port
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve(port)
        }
      }
    })

    goProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[go-backend]', data.toString())
    })

    goProcess.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(err)
      }
    })

    goProcess.on('exit', (code) => {
      console.log(`[go-backend] exited with code ${code}`)
      goProcess = null
    })
  })
}

function stopGoBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (!goProcess) {
      resolve()
      return
    }

    const forceTimeout = setTimeout(() => {
      if (goProcess) {
        goProcess.kill('SIGKILL')
        goProcess = null
      }
      resolve()
    }, 5000)

    goProcess.on('exit', () => {
      clearTimeout(forceTimeout)
      goProcess = null
      resolve()
    })

    // 鍙戦€?SIGTERM 璇锋眰浼橀泤閫€鍑?
    if (process.platform === 'win32') {
      goProcess.kill()
    } else {
      goProcess.kill('SIGTERM')
    }
  })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#16162A',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 寮€鍙戞ā寮忓姞杞?Vite 寮€鍙戞湇鍔″櫒锛岀敓浜фā寮忓姞杞芥墦鍖呮枃浠?
  if (isDevMode) {
    mainWindow.loadURL(DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 澶栭儴閾炬帴浣跨敤绯荤粺娴忚鍣ㄦ墦寮€
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC: 娓叉煋杩涚▼鑾峰彇鍚庣绔彛鍙?
ipcMain.handle('get-backend-port', () => backendPort)

// IPC: 绐楀彛鎺у埗
ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.handle('window-close', () => mainWindow?.close())
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized())

app.whenReady().then(async () => {
  try {
    backendPort = await startGoBackend()
    console.log(`[go-backend] started on port ${backendPort}`)
  } catch (err) {
    console.error('[go-backend] failed to start:', err)
  }

  await createWindow()
})

app.on('window-all-closed', async () => {
  await stopGoBackend()
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

app.on('before-quit', async () => {
  await stopGoBackend()
})
