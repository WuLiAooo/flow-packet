import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'

app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null
let goProcess: ChildProcess | null = null
let backendPort: number | null = null
let backendStartupPromise: Promise<number> | null = null

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
    return getDevBackendDir()
  }

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

    backendPort = null
    goProcess = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    goProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      const match = output.match(/PORT:(\d+)/)
      if (!match) {
        return
      }

      const port = parseInt(match[1], 10)
      backendPort = port
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        resolve(port)
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
      backendPort = null
      backendStartupPromise = null
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        reject(new Error(`Go backend exited before reporting port (code ${code ?? 'unknown'})`))
      }
    })
  })
}

function ensureGoBackendStarted(): Promise<number> {
  if (backendPort !== null) {
    return Promise.resolve(backendPort)
  }
  if (backendStartupPromise) {
    return backendStartupPromise
  }

  backendStartupPromise = startGoBackend()
    .then((port) => {
      backendPort = port
      return port
    })
    .catch((err) => {
      backendStartupPromise = null
      throw err
    })

  return backendStartupPromise
}

function stopGoBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (!goProcess) {
      backendPort = null
      backendStartupPromise = null
      resolve()
      return
    }

    const currentProcess = goProcess
    const forceTimeout = setTimeout(() => {
      if (goProcess === currentProcess && goProcess) {
        goProcess.kill('SIGKILL')
        goProcess = null
      }
      backendPort = null
      backendStartupPromise = null
      resolve()
    }, 5000)

    currentProcess.once('exit', () => {
      clearTimeout(forceTimeout)
      if (goProcess === currentProcess) {
        goProcess = null
      }
      backendPort = null
      backendStartupPromise = null
      resolve()
    })

    if (process.platform === 'win32') {
      currentProcess.kill()
    } else {
      currentProcess.kill('SIGTERM')
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

  if (isDevMode) {
    await mainWindow.loadURL(DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

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

ipcMain.handle('get-backend-port', async () => ensureGoBackendStarted())
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
  await createWindow()

  ensureGoBackendStarted()
    .then((port) => {
      console.log(`[go-backend] started on port ${port}`)
    })
    .catch((err) => {
      console.error('[go-backend] failed to start:', err)
    })
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
