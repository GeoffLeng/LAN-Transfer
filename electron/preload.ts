import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  sendFiles: (targetIp: string, files: { path: string; name: string; size: number }[], transferId: string) => 
    ipcRenderer.invoke('send-files', { targetIp, files, transferId }),
  acceptTransfer: (id: string, accept: boolean) => 
    ipcRenderer.invoke('accept-transfer', { id, accept }),
  getMyNickname: () => ipcRenderer.invoke('get-my-nickname'),
  setMyNickname: (nickname: string) => ipcRenderer.invoke('set-my-nickname', nickname),
  getMyIp: () => ipcRenderer.invoke('get-my-ip'),
  getMyAvatarIndex: () => ipcRenderer.invoke('get-my-avatar-index'),
  setMyAvatarIndex: (idx: number) => ipcRenderer.invoke('set-my-avatar-index', idx),
  minimizeWindow: () => ipcRenderer.send('window-min'),
  maximizeWindow: () => ipcRenderer.send('window-max'),
  closeWindow: () => ipcRenderer.send('window-close'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getSaveDir: () => ipcRenderer.invoke('get-save-dir'),
  setSaveDir: (dir: string) => ipcRenderer.invoke('set-save-dir', dir),
  pauseTransfer: (id: string) => ipcRenderer.invoke('pause-transfer', id),
  resumeTransfer: (id: string) => ipcRenderer.invoke('resume-transfer', id),
  cancelTransfer: (id: string) => ipcRenderer.invoke('cancel-transfer', id),
  getWebServerStatus: () => ipcRenderer.invoke('get-web-server-status'),
  toggleWebServer: (enable: boolean) => ipcRenderer.invoke('toggle-web-server', enable),
  shareFileToWeb: (filePath: string) => ipcRenderer.invoke('share-file-to-web', filePath),
  
  onDeviceListUpdate: (callback: (devices: any[]) => void) => {
    const subscription = (_event: any, value: any[]) => callback(value)
    ipcRenderer.on('device-list-update', subscription)
    return () => {
      ipcRenderer.off('device-list-update', subscription)
    }
  },
  onTransferProgress: (callback: (data: any) => void) => {
    const subscription = (_event: any, value: any) => callback(value)
    ipcRenderer.on('transfer-progress', subscription)
    return () => {
      ipcRenderer.off('transfer-progress', subscription)
    }
  },
  onIncomingTransfer: (callback: (data: { id: string; senderName: string; files: any[]; totalSize: number }) => void) => {
    const subscription = (_event: any, value: any) => callback(value)
    ipcRenderer.on('incoming-transfer', subscription)
    return () => {
      ipcRenderer.off('incoming-transfer', subscription)
    }
  }
})
