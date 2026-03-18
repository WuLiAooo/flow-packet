import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('flowPacket', {
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
})
