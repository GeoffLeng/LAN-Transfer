import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import Bonjour from 'bonjour-service'
import { webServer } from './webServer'

// Interface definitions
interface Peer {
  id: string
  name: string
  ip: string
  port: number
  lastSeen: number
  avatarIndex: number
}

interface TransferFile {
  path: string
  name: string
  size: number
}

let mainWindow: BrowserWindow | null = null
let bonjour: Bonjour | null = null
let myNickname = ''
let myAvatarIndex = 0
let saveDir = path.join(os.homedir(), 'Downloads')
const activePeers = new Map<string, Peer>()
let tcpServer: net.Server | null = null
const activeIncomingTransfers = new Map<string, { socket: net.Socket; files: any[]; senderName: string; senderIp: string; isPaused: boolean; totalBytesReceived: number; totalSize: number }>()
const activeOutgoings = new Map<string, { socket: net.Socket; readStream?: fs.ReadStream; isPaused: boolean; targetIp: string }>()

const PORT = 12138 // Default TCP Transfer Port
const MDNS_TYPE = 'trans-service'

// Helper to get local IP
function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  const candidateIps: string[] = []

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase()
    // Exclude common virtual network interfaces
    if (
      lowerName.includes('virtual') ||
      lowerName.includes('wsl') ||
      lowerName.includes('vbox') ||
      lowerName.includes('vmware') ||
      lowerName.includes('loopback') ||
      (lowerName.includes('ethernet adapter') && lowerName.includes('vethernet')) ||
      lowerName.includes('vethernet') ||
      lowerName.includes('host-only') ||
      lowerName.includes('pseudo')
    ) {
      continue
    }

    for (const netInterface of interfaces[name] || []) {
      if (netInterface.family === 'IPv4' && !netInterface.internal) {
        const ip = netInterface.address
        // Skip link-local addresses (APIPA)
        if (ip.startsWith('169.254.')) {
          continue
        }
        candidateIps.push(ip)
      }
    }
  }

  if (candidateIps.length === 0) {
    return '127.0.0.1'
  }

  // Prioritize 192.168.*.* range
  const prioritized = candidateIps.find(ip => ip.startsWith('192.168.'))
  if (prioritized) return prioritized

  // Next prioritize 10.*.*.* or 172.16-31.*.* ranges
  const classAOrB = candidateIps.find(ip => {
    if (ip.startsWith('10.')) return true
    if (ip.startsWith('172.')) {
      const parts = ip.split('.')
      const secondOctet = parseInt(parts[1], 10)
      return secondOctet >= 16 && secondOctet <= 31
    }
    return false
  })
  if (classAOrB) return classAOrB

  return candidateIps[0]
}

const myIp = getLocalIp()

// Get configurations
const configPath = path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      myNickname = data.nickname || `${os.userInfo().username || 'WinUser'}_${Math.floor(100 + Math.random() * 900)}`
      myAvatarIndex = typeof data.avatarIndex === 'number' ? data.avatarIndex : Math.floor(Math.random() * 6)
      saveDir = data.saveDir || path.join(os.homedir(), 'Downloads')
    } else {
      myNickname = `${os.userInfo().username || 'WinUser'}_${Math.floor(100 + Math.random() * 900)}`
      myAvatarIndex = Math.floor(Math.random() * 6)
      saveDir = path.join(os.homedir(), 'Downloads')
      saveConfig()
    }
  } catch (e) {
    myNickname = `User_${Math.floor(1000 + Math.random() * 9000)}`
    myAvatarIndex = 0
    saveDir = path.join(os.homedir(), 'Downloads')
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify({ nickname: myNickname, avatarIndex: myAvatarIndex, saveDir }), 'utf-8')
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

// Window creation
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: true,
    hasShadow: false,
    icon: path.join(__dirname, '../logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true
    }
  })

  // Load standard Dev Server or production index.html
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Register and Broadcast via mDNS
function startDiscovery() {
  try {
    bonjour = new Bonjour()

    // 1. Publish own service
    bonjour.publish({
      name: `${myNickname}-${myIp.replace(/\./g, '-')}`,
      type: MDNS_TYPE,
      port: PORT,
      txt: {
        nickname: myNickname,
        avatarIndex: String(myAvatarIndex),
        ip: myIp
      }
    })

    // 2. Discover others
    const browser = bonjour.find({ type: MDNS_TYPE })

    browser.on('up', (service) => {
      const peerIp = service.txt?.ip || service.referer?.address || '127.0.0.1'
      if (peerIp === myIp) return // Skip self

      const peerNickname = service.txt?.nickname || service.name
      const peerAvatar = parseInt(service.txt?.avatarIndex || '0', 10)
      const peerId = `${peerNickname}-${peerIp}`

      activePeers.set(peerId, {
        id: peerId,
        name: peerNickname,
        ip: peerIp,
        port: service.port,
        lastSeen: Date.now(),
        avatarIndex: peerAvatar
      })

      sendPeerList()
    })

    browser.on('down', (service) => {
      const peerIp = service.txt?.ip || service.referer?.address || '127.0.0.1'
      const peerNickname = service.txt?.nickname || service.name
      const peerId = `${peerNickname}-${peerIp}`
      
      activePeers.delete(peerId)
      sendPeerList()
    })

    // Periodically sweep stale peers (older than 15s, excluding mobile web peers handled by SSE events)
    setInterval(() => {
      let changed = false
      const now = Date.now()
      for (const [id, peer] of activePeers.entries()) {
        if (!(peer as any).isMobile && now - peer.lastSeen > 15000) {
          activePeers.delete(id)
          changed = true
        }
      }
      if (changed) sendPeerList()
    }, 5000)

    // Trigger active TCP Subnet Scanning!
    startSubnetScan()

  } catch (e) {
    console.error('mDNS error:', e)
  }
}

let scanInterval: NodeJS.Timeout | null = null

function startSubnetScan() {
  if (scanInterval) clearInterval(scanInterval)
  scanLocalNetwork()
  scanInterval = setInterval(scanLocalNetwork, 6000)
}

function scanLocalNetwork() {
  if (!myIp || myIp === '127.0.0.1') return
  const subnet = myIp.substring(0, myIp.lastIndexOf('.'))
  
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`
    if (ip === myIp) continue
    
    const socket = new net.Socket()
    socket.setTimeout(1200)
    
    socket.connect(PORT, ip, () => {
      const pingPayload = JSON.stringify({
        type: 'ping',
        senderName: myNickname,
        avatarIndex: myAvatarIndex,
        ip: myIp
      })
      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeInt32BE(Buffer.byteLength(pingPayload))
      socket.write(Buffer.concat([sizeBuf, Buffer.from(pingPayload, 'utf-8')]))
    })
    
    socket.on('data', (data) => {
      try {
        const info = JSON.parse(data.toString('utf-8'))
        if (info.status === 'pong') {
          const peerId = `${info.nickname}-${ip}`
          activePeers.set(peerId, {
            id: peerId,
            name: info.nickname,
            ip: ip,
            port: PORT,
            lastSeen: Date.now(),
            avatarIndex: info.avatarIndex
          })
          sendPeerList()
        }
      } catch (e) {
        // ignore
      }
      socket.destroy()
    })
    
    socket.on('error', () => {
      socket.destroy()
    })
    
    socket.on('timeout', () => {
      socket.destroy()
    })
  }
}

function sendPeerList() {
  const peerList = Array.from(activePeers.values())
  if (mainWindow) {
    mainWindow.webContents.send('device-list-update', peerList)
  }
  webServer.broadcastPeers(peerList)
}

// Start TCP Server for File Reception
function startTcpServer() {
  tcpServer = net.createServer((socket) => {
    socket.setNoDelay(true)
    let transferId = ''
    let isAccepted = false
    let fileStream: fs.WriteStream | null = null
    let bytesReceivedForCurrentFile = 0
    let currentFileIndex = 0
    let filesMetadata: any[] = []
    let totalBytesReceived = 0
    let totalSize = 0
    let isSpeedTest = false
    let buffer = Buffer.alloc(0)
    let currentFileExpectedSize = 0
    let lastIpcTime = 0

    socket.on('data', (chunk) => {
      if (isSpeedTest) {
        totalBytesReceived += chunk.length
        if (totalBytesReceived >= totalSize) {
          socket.write(JSON.stringify({ status: 'complete' }))
          socket.destroy()
        }
        return
      }

      let offset = 0
      while (offset < chunk.length) {
        if (fileStream) {
          const bytesNeeded = currentFileExpectedSize - bytesReceivedForCurrentFile
          const bytesToWrite = Math.min(chunk.length - offset, bytesNeeded)

          if (bytesToWrite > 0) {
            fileStream.write(chunk.subarray(offset, offset + bytesToWrite))
            bytesReceivedForCurrentFile += bytesToWrite
            totalBytesReceived += bytesToWrite
            offset += bytesToWrite

            const incoming = activeIncomingTransfers.get(transferId)
            if (incoming) {
              incoming.totalBytesReceived = totalBytesReceived
            }

            // Notify UI of transfer progress (throttled to 150ms)
            const now = Date.now()
            if (now - lastIpcTime > 150 || totalBytesReceived === totalSize) {
              lastIpcTime = now
              if (mainWindow) {
                mainWindow.webContents.send('transfer-progress', {
                  id: transferId,
                  direction: 'incoming',
                  progress: totalBytesReceived / totalSize,
                  speed: 0, // Calculated in frontend
                  bytesTransferred: totalBytesReceived,
                  totalSize
                })
              }
            }
          }

          if (bytesReceivedForCurrentFile === currentFileExpectedSize) {
            fileStream.end()
            fileStream = null
            currentFileIndex++

            if (currentFileIndex === filesMetadata.length) {
              // Transfer complete!
              socket.write(JSON.stringify({ status: 'complete' }))
              socket.destroy()
              activeIncomingTransfers.delete(transferId)
              return
            }
          }
        } else {
          // Prevent buffer from growing infinitely (OOM protection)
          if (buffer.length > 1024 * 1024 * 5) {
            socket.destroy()
            return
          }

          buffer = Buffer.concat([buffer, chunk.subarray(offset)])
          offset = chunk.length // Consume all remaining bytes of the chunk into the buffer

          let processed = true
          while (processed && !fileStream && buffer.length > 0) {
            processed = false
            if (!isAccepted) {
              if (buffer.length < 4) break
              const jsonLength = buffer.readInt32BE(0)
              
              // Validate packet size limits to prevent negative/overflow values
              if (jsonLength <= 0 || jsonLength > 1024 * 1024) {
                socket.destroy()
                return
              }
              
              if (buffer.length < 4 + jsonLength) break

              const jsonStr = buffer.subarray(4, 4 + jsonLength).toString('utf-8')
              buffer = buffer.subarray(4 + jsonLength)
              processed = true

              try {
                const metadata = JSON.parse(jsonStr)

                // Handle ping control packet
                if (metadata.type === 'ping') {
                  const pongPayload = JSON.stringify({
                    status: 'pong',
                    nickname: myNickname,
                    avatarIndex: myAvatarIndex
                  })
                  socket.write(pongPayload)
                  socket.destroy()

                  // Add peer if valid
                  const peerIp = metadata.ip
                  if (peerIp && peerIp !== myIp) {
                    const peerId = `${metadata.senderName}-${peerIp}`
                    activePeers.set(peerId, {
                      id: peerId,
                      name: metadata.senderName,
                      ip: peerIp,
                      port: PORT,
                      lastSeen: Date.now(),
                      avatarIndex: metadata.avatarIndex
                    })
                    sendPeerList()
                  }
                  return
                }

                if (metadata.type === 'control') {
                  const ctrlId = metadata.id
                  const action = metadata.action
                  const incoming = activeIncomingTransfers.get(ctrlId)
                  if (incoming) {
                    if (action === 'pause') {
                      incoming.isPaused = true
                      incoming.socket.pause()
                      if (mainWindow) {
                        mainWindow.webContents.send('transfer-progress', {
                          id: ctrlId,
                          direction: 'incoming',
                          isPaused: true,
                          progress: incoming.totalBytesReceived / incoming.totalSize,
                          bytesTransferred: incoming.totalBytesReceived,
                          totalSize: incoming.totalSize
                        })
                      }
                    } else if (action === 'resume') {
                      incoming.isPaused = false
                      incoming.socket.resume()
                      if (mainWindow) {
                        mainWindow.webContents.send('transfer-progress', {
                          id: ctrlId,
                          direction: 'incoming',
                          isPaused: false,
                          progress: incoming.totalBytesReceived / incoming.totalSize,
                          bytesTransferred: incoming.totalBytesReceived,
                          totalSize: incoming.totalSize
                        })
                      }
                    } else if (action === 'cancel') {
                      if (mainWindow) {
                        mainWindow.webContents.send('transfer-progress', {
                          id: ctrlId,
                          direction: 'incoming',
                          status: 'cancelled',
                          senderName: incoming.senderName,
                          totalSize: incoming.totalSize
                        })
                      }
                      incoming.socket.destroy()
                      activeIncomingTransfers.delete(ctrlId)
                    }
                  } else {
                    const outgoing = activeOutgoings.get(ctrlId)
                    if (outgoing && action === 'cancel') {
                      if (mainWindow) {
                        mainWindow.webContents.send('transfer-progress', {
                          id: ctrlId,
                          direction: 'outgoing',
                          status: 'cancelled',
                          totalSize: outgoing.socket.bytesWritten
                        })
                      }
                      outgoing.socket.destroy()
                      activeOutgoings.delete(ctrlId)
                    }
                  }
                  socket.destroy()
                  return
                }

                transferId = metadata.id
                totalSize = metadata.totalSize
                const senderName = metadata.senderName
                const senderIp = socket.remoteAddress?.replace('::ffff:', '') || ''

                if (metadata.type === 'speed-test') {
                  isSpeedTest = true
                  isAccepted = true
                  activeIncomingTransfers.set(transferId, {
                    socket,
                    files: [],
                    senderName,
                    senderIp,
                    isPaused: false,
                    totalBytesReceived: 0,
                    totalSize
                  })
                  socket.write(JSON.stringify({ status: 'accepted' }))
                  return
                }

                filesMetadata = metadata.files

                activeIncomingTransfers.set(transferId, {
                  socket,
                  files: filesMetadata,
                  senderName,
                  senderIp,
                  isPaused: false,
                  totalBytesReceived: 0,
                  totalSize
                })

                // Notify frontend of incoming request
                if (mainWindow) {
                  mainWindow.webContents.send('incoming-transfer', {
                    id: transferId,
                    senderName,
                    files: filesMetadata,
                    totalSize
                  })
                }
                isAccepted = true // Handshake received, wait for user acceptance via accept-transfer IPC
              } catch (e) {
                console.error('Failed to parse metadata handshake:', e)
                socket.write(JSON.stringify({ status: 'error', message: 'Invalid handshake' }))
                socket.destroy()
              }
            } else {
              // accepted and expecting a file header
              if (buffer.length < 4) break
              const headerLength = buffer.readInt32BE(0)
              
              // Validate packet size limits to prevent negative/overflow values
              if (headerLength <= 0 || headerLength > 1024 * 1024) {
                socket.destroy()
                return
              }
              
              if (buffer.length < 4 + headerLength) break

              const headerJson = buffer.subarray(4, 4 + headerLength).toString('utf-8')
              buffer = buffer.subarray(4 + headerLength)
              processed = true

              try {
                const fileHeader = JSON.parse(headerJson)
                const relativePath = fileHeader.relPath
                currentFileExpectedSize = fileHeader.size
                bytesReceivedForCurrentFile = 0

                // Security: sanitize path to prevent directory traversal attacks.
                // Replace all backslashes with forward slashes to ensure cross-platform safety for path.basename.
                const normalizedPath = relativePath.replace(/\\/g, '/')
                const safeName = path.basename(normalizedPath)
                const destPath = path.join(saveDir, safeName)
                const destDir = path.dirname(destPath)
                if (!fs.existsSync(destDir)) {
                  fs.mkdirSync(destDir, { recursive: true })
                }

                fileStream = fs.createWriteStream(destPath, { highWaterMark: 1024 * 1024 * 4 })
              } catch (e) {
                console.error('Failed to parse file header:', e)
                socket.destroy()
                return
              }
            }
          }
        }
      }
    })

    socket.on('error', (err) => {
      console.error('Receiver Socket error:', err)
      if (fileStream) fileStream.end()
      if (transferId) activeIncomingTransfers.delete(transferId)
    })

    socket.on('close', () => {
      if (fileStream) fileStream.end()
      if (transferId) activeIncomingTransfers.delete(transferId)
    })
  })

  tcpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TCP File Transfer Server listening on port ${PORT}`)
  })
}

function initWebServer() {
  webServer.setCallbacks(
    () => ({ nickname: myNickname, ip: myIp, avatarIndex: myAvatarIndex }),
    () => Array.from(activePeers.values()),
    () => saveDir
  )

  webServer.on('mobile-peer-register', (data: { ip: string }) => {
    const peerId = `mobile-${data.ip}`
    if (!activePeers.has(peerId)) {
      activePeers.set(peerId, {
        id: peerId,
        name: `手机设备 (${data.ip.split('.').slice(-2).join('.')})`,
        ip: data.ip,
        port: 12139,
        lastSeen: Date.now(),
        avatarIndex: 0,
        isMobile: true
      } as any)
      sendPeerList()
    }
  })

  webServer.on('mobile-peer-heartbeat', (data: { ip: string }) => {
    const peerId = `mobile-${data.ip}`
    const existing = activePeers.get(peerId)
    if (existing) {
      existing.lastSeen = Date.now()
    } else {
      activePeers.set(peerId, {
        id: peerId,
        name: `手机设备 (${data.ip.split('.').slice(-2).join('.')})`,
        ip: data.ip,
        port: 12139,
        lastSeen: Date.now(),
        avatarIndex: 0,
        isMobile: true
      } as any)
      sendPeerList()
    }
  })

  webServer.on('mobile-peer-update', (data: { ip: string; nickname: string }) => {
    const peerId = `mobile-${data.ip}`
    const existing = activePeers.get(peerId)
    if (existing) {
      existing.name = data.nickname
      existing.lastSeen = Date.now()
    } else {
      activePeers.set(peerId, {
        id: peerId,
        name: data.nickname,
        ip: data.ip,
        port: 12139,
        lastSeen: Date.now(),
        avatarIndex: 0,
        isMobile: true
      } as any)
    }
    sendPeerList()
  })

  webServer.on('mobile-peer-unregister', (data: { ip: string }) => {
    const peerId = `mobile-${data.ip}`
    activePeers.delete(peerId)
    sendPeerList()
  })

  webServer.on('mobile-upload-start', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('incoming-transfer', {
        id: data.id,
        senderName: data.senderName,
        files: [{ name: data.fileName, size: data.totalSize }],
        totalSize: data.totalSize
      })
    }
  })

  webServer.on('mobile-upload-progress', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('transfer-progress', {
        id: data.id,
        direction: 'incoming',
        progress: data.progress,
        bytesTransferred: data.bytesTransferred,
        totalSize: data.totalSize
      })
    }
  })

  webServer.on('mobile-upload-complete', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('transfer-progress', {
        id: data.id,
        direction: 'incoming',
        progress: 1,
        bytesTransferred: data.totalSize,
        totalSize: data.totalSize
      })
    }
  })

  webServer.start(12139).catch(err => console.error('Failed to start webServer:', err))
}

// App lifecycle
app.whenReady().then(() => {
  try {
    os.setPriority(os.constants.priority.PRIORITY_HIGH)
  } catch (e) {
    // Ignore priority errors on unsupported OS permissions
  }
  loadConfig()
  createWindow()
  startDiscovery()
  startTcpServer()
  initWebServer()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (bonjour) {
    bonjour.unpublishAll(() => {
      bonjour?.destroy()
    })
  }
  if (process.platform !== 'darwin') app.quit()
})

// IPC Handlers
ipcMain.handle('select-files', async () => {
  if (!mainWindow) return []
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: '选择要发送的文件'
  })
  if (result.canceled) return []
  
  return result.filePaths.map(filePath => {
    return {
      path: filePath,
      name: path.basename(filePath),
      size: fs.statSync(filePath).size
    }
  })
})

ipcMain.handle('get-my-nickname', () => myNickname)
ipcMain.handle('get-my-ip', () => myIp)
ipcMain.handle('get-my-avatar-index', () => myAvatarIndex)
ipcMain.handle('set-my-avatar-index', (_event, idx) => {
  myAvatarIndex = Number(idx)
  saveConfig()
  if (bonjour) {
    bonjour.unpublishAll(() => {
      bonjour?.publish({
        name: `${myNickname}-${myIp.replace(/\./g, '-')}`,
        type: MDNS_TYPE,
        port: PORT,
        txt: {
          nickname: myNickname,
          avatarIndex: String(myAvatarIndex),
          ip: myIp
        }
      })
    })
  }
  return myAvatarIndex
})

ipcMain.handle('set-my-nickname', (_event, nickname) => {
  myNickname = nickname.trim()
  saveConfig()
  
  // Re-publish mDNS
  if (bonjour) {
    bonjour.unpublishAll(() => {
      bonjour?.publish({
        name: `${myNickname}-${myIp.replace(/\./g, '-')}`,
        type: MDNS_TYPE,
        port: PORT,
        txt: {
          nickname: myNickname,
          avatarIndex: String(myAvatarIndex),
          ip: myIp
        }
      })
    })
  }
  return myNickname
})

ipcMain.handle('accept-transfer', async (_event, { id, accept }) => {
  const incoming = activeIncomingTransfers.get(id)
  if (!incoming) return false

  if (accept) {
    // Notify peer sender to start transmission
    incoming.socket.write(JSON.stringify({ status: 'accepted' }))
  } else {
    incoming.socket.write(JSON.stringify({ status: 'declined' }))
    incoming.socket.destroy()
    activeIncomingTransfers.delete(id)
  }
  return true
})

ipcMain.handle('start-speed-test', async (_event, { targetIp }: { targetIp: string }) => {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const transferId = `speedtest-${Date.now()}`
    const totalSize = 120 * 1024 * 1024 // 120MB 测速上限
    let totalBytesSent = 0
    let lastIpcTime = 0
    let startTime = Date.now()

    socket.connect(PORT, targetIp, () => {
      socket.setNoDelay(true)
      const handshake = JSON.stringify({
        type: 'speed-test',
        id: transferId,
        senderName: myNickname,
        totalSize
      })
      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeInt32BE(Buffer.byteLength(handshake))
      socket.write(Buffer.concat([sizeBuf, Buffer.from(handshake, 'utf-8')]))
    })

    socket.on('data', (data) => {
      let response
      try {
        response = JSON.parse(data.toString('utf-8'))
      } catch {
        socket.destroy()
        resolve({ success: false, error: 'Invalid response' })
        return
      }

      if (response.status === 'accepted') {
        const testChunk = Buffer.alloc(2 * 1024 * 1024) // 2MB
        startTime = Date.now()

        const pump = () => {
          if (totalBytesSent >= totalSize) {
            return
          }
          const payload = testChunk.subarray(0, Math.min(testChunk.length, totalSize - totalBytesSent))
          const canWrite = socket.write(payload)
          totalBytesSent += payload.length

          const now = Date.now()
          if (now - lastIpcTime > 150 || totalBytesSent === totalSize) {
            lastIpcTime = now
            const elapsedTime = (now - startTime) / 1000 || 0.1
            const currentMbps = ((totalBytesSent * 8) / 1024 / 1024) / elapsedTime
            if (mainWindow) {
              mainWindow.webContents.send('transfer-progress', {
                id: transferId,
                direction: 'outgoing',
                isSpeedTest: true,
                progress: totalBytesSent / totalSize,
                currentMbps: currentMbps,
                bytesTransferred: totalBytesSent,
                totalSize
              })
            }
          }

          if (canWrite) {
            process.nextTick(pump)
          } else {
            socket.once('drain', pump)
          }
        }
        pump()
      } else if (response.status === 'complete') {
        const duration = (Date.now() - startTime) / 1000 || 0.1
        const avgMbps = ((totalBytesSent * 8) / 1024 / 1024) / duration
        socket.destroy()
        resolve({ success: true, speedMbps: avgMbps })
      }
    })

    socket.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
})

// Send files P2P logic
ipcMain.handle('send-files', async (_event, { targetIp, files, transferId }: { targetIp: string; files: TransferFile[]; transferId: string }) => {
  return new Promise((resolve) => {
    // Check if target is a mobile web peer
    const isMobilePeer = Array.from(activePeers.values()).some(p => p.ip === targetIp && (p as any).isMobile)
    if (isMobilePeer) {
      let totalSize = files.reduce((acc, f) => acc + f.size, 0)
      for (const f of files) {
        const fileId = `web-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        webServer.addPendingDownload({
          id: fileId,
          name: f.name,
          size: f.size,
          path: f.path,
          senderName: myNickname,
          targetIp: targetIp,
          time: Date.now()
        })
      }
      if (mainWindow) {
        mainWindow.webContents.send('transfer-progress', {
          id: transferId,
          direction: 'outgoing',
          progress: 1,
          bytesTransferred: totalSize,
          totalSize
        })
      }
      return resolve({ success: true })
    }

    const socket = new net.Socket()
    let totalSize = files.reduce((acc, f) => acc + f.size, 0)
    let totalBytesSent = 0

    activeOutgoings.set(transferId, { socket, isPaused: false, targetIp })

    let resolved = false
    const resolveWithCleanup = (val: any) => {
      if (resolved) return
      resolved = true
      activeOutgoings.delete(transferId)
      resolve(val)
    }

    socket.connect(PORT, targetIp, () => {
      socket.setNoDelay(true)
      // 1. Send Handshake metadata JSON
      const handshake = JSON.stringify({
        id: transferId,
        senderName: myNickname,
        totalSize,
        files: files.map(f => ({ name: f.name, size: f.size }))
      })

      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeInt32BE(Buffer.byteLength(handshake))
      socket.write(Buffer.concat([sizeBuf, Buffer.from(handshake, 'utf-8')]))
    })

    socket.on('data', async (data) => {
      let response
      try {
        response = JSON.parse(data.toString('utf-8'))
      } catch {
        console.error('Failed to parse sender response')
        socket.destroy()
        resolveWithCleanup({ success: false, error: 'Invalid response' })
        return
      }
      if (response.status === 'accepted') {
        // Start streaming files sequentially
        for (const file of files) {
          try {
            await sendSingleFile(socket, file)
          } catch (e) {
            console.error('File stream error:', e)
            socket.destroy()
            resolveWithCleanup({ success: false, error: 'Transmission interrupted' })
            return
          }
        }
      } else if (response.status === 'declined') {
        socket.destroy()
        resolveWithCleanup({ success: false, error: 'Rejected by receiver' })
      } else if (response.status === 'complete') {
        socket.destroy()
        resolveWithCleanup({ success: true })
      }
    })

    function sendSingleFile(clientSocket: net.Socket, file: TransferFile): Promise<void> {
      return new Promise((resolveFile, rejectFile) => {
        // 1. Send file header
        const header = JSON.stringify({ relPath: file.name, size: file.size })
        const lenBuf = Buffer.alloc(4)
        lenBuf.writeInt32BE(Buffer.byteLength(header))
        clientSocket.write(Buffer.concat([lenBuf, Buffer.from(header, 'utf-8')]))

        // 2. Stream file data with 2MB chunk buffer for maximum TCP throughput
        const readStream = fs.createReadStream(file.path, { highWaterMark: 1024 * 1024 * 2 })
        
        const entry = activeOutgoings.get(transferId)
        if (entry) {
          entry.readStream = readStream
          if (entry.isPaused) {
            readStream.pause()
          }
        }

        let lastIpcTime = 0
        readStream.on('data', (chunk) => {
          totalBytesSent += chunk.length
          
          const now = Date.now()
          if (now - lastIpcTime > 150 || totalBytesSent === totalSize) {
            lastIpcTime = now
            if (mainWindow) {
              mainWindow.webContents.send('transfer-progress', {
                id: transferId,
                direction: 'outgoing',
                progress: totalBytesSent / totalSize,
                speed: 0, // Calculated in frontend
                bytesTransferred: totalBytesSent,
                totalSize
              })
            }
          }
        })

        readStream.pipe(clientSocket, { end: false })

        readStream.on('end', () => {
          resolveFile()
        })

        readStream.on('error', (err) => {
          rejectFile(err)
        })
      })
    }

    socket.on('error', (err) => {
      console.error('Sender socket error:', err)
      const entry = activeOutgoings.get(transferId)
      if (entry && entry.readStream) entry.readStream.destroy()
      resolveWithCleanup({ success: false, error: err.message })
    })

    socket.on('close', () => {
      const entry = activeOutgoings.get(transferId)
      if (entry && entry.readStream) entry.readStream.destroy()
      resolveWithCleanup({ success: false, error: 'Connection closed' })
    })
  })
})

function sendControlMessage(targetIp: string, transferId: string, action: 'pause' | 'resume' | 'cancel') {
  const socket = new net.Socket()
  socket.setTimeout(3000)
  socket.connect(PORT, targetIp, () => {
    socket.setNoDelay(true)
    const payload = JSON.stringify({
      type: 'control',
      id: transferId,
      action
    })
    const sizeBuf = Buffer.alloc(4)
    sizeBuf.writeInt32BE(Buffer.byteLength(payload))
    socket.write(Buffer.concat([sizeBuf, Buffer.from(payload, 'utf-8')]))
  })
  socket.on('error', (err) => {
    console.error('Failed to send control message:', err)
    socket.destroy()
  })
  socket.on('timeout', () => {
    socket.destroy()
  })
  socket.on('data', () => {
    socket.destroy()
  })
}

ipcMain.handle('get-save-dir', () => saveDir)
ipcMain.handle('set-save-dir', (_event, dir) => {
  saveDir = dir
  saveConfig()
  webServer.updateSaveDir(dir)
  return saveDir
})
ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择接收文件夹'
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('pause-transfer', (_event, id) => {
  const outgoing = activeOutgoings.get(id)
  if (outgoing) {
    outgoing.isPaused = true
    if (outgoing.readStream) {
      outgoing.readStream.pause()
    }
    sendControlMessage(outgoing.targetIp, id, 'pause')
    return true
  }
  const incoming = activeIncomingTransfers.get(id)
  if (incoming) {
    incoming.isPaused = true
    incoming.socket.pause()
    return true
  }
  return false
})

ipcMain.handle('resume-transfer', (_event, id) => {
  const outgoing = activeOutgoings.get(id)
  if (outgoing) {
    outgoing.isPaused = false
    if (outgoing.readStream) {
      outgoing.readStream.resume()
    }
    sendControlMessage(outgoing.targetIp, id, 'resume')
    return true
  }
  const incoming = activeIncomingTransfers.get(id)
  if (incoming) {
    incoming.isPaused = false
    incoming.socket.resume()
    return true
  }
  return false
})

ipcMain.handle('cancel-transfer', (_event, id) => {
  const outgoing = activeOutgoings.get(id)
  if (outgoing) {
    // Stop readStream first to prevent more data from being piped
    if (outgoing.readStream) {
      outgoing.readStream.destroy()
    }
    outgoing.socket.destroy()
    activeOutgoings.delete(id)
    // Notify the receiver asynchronously (new socket)
    sendControlMessage(outgoing.targetIp, id, 'cancel')
    return true
  }
  const incoming = activeIncomingTransfers.get(id)
  if (incoming) {
    incoming.socket.destroy()
    activeIncomingTransfers.delete(id)
    // Notify the sender asynchronously (new socket)
    if (incoming.senderIp) {
      sendControlMessage(incoming.senderIp, id, 'cancel')
    }
    return true
  }
  return false
})

ipcMain.handle('get-web-server-status', () => {
  return {
    isRunning: webServer.getIsRunning(),
    port: webServer.getPort(),
    url: `http://${myIp}:${webServer.getPort()}`
  }
})

ipcMain.handle('toggle-web-server', async (_event, enable: boolean) => {
  if (enable) {
    const port = await webServer.start()
    return { isRunning: true, port, url: `http://${myIp}:${port}` }
  } else {
    webServer.stop()
    return { isRunning: false, port: webServer.getPort(), url: '' }
  }
})

ipcMain.handle('share-file-to-web', async (_event, filePath: string) => {
  if (!fs.existsSync(filePath)) return false
  const stat = fs.statSync(filePath)
  const fileId = `web-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  webServer.addPendingDownload({
    id: fileId,
    name: path.basename(filePath),
    size: stat.size,
    path: filePath,
    senderName: myNickname,
    time: Date.now()
  })
  return true
})

// Window control handlers (Minimize, Maximize, Close)
ipcMain.on('window-min', () => {
  mainWindow?.minimize()
})
ipcMain.on('window-max', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window-close', () => {
  mainWindow?.close()
})
