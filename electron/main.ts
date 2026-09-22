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
    let currentFileExpectedSize = 0
    let lastIpcTime = 0
    let controlBuffer = Buffer.alloc(0)
    let isSocketEnded = false

    function processChunk(chunk: Buffer) {
      if (isSocketEnded) return
      let offset = 0

      while (offset < chunk.length && !isSocketEnded) {
        if (fileStream) {
          const bytesNeeded = currentFileExpectedSize - bytesReceivedForCurrentFile
          const bytesAvailable = chunk.length - offset
          const bytesToWrite = Math.min(bytesAvailable, bytesNeeded)

          if (bytesToWrite > 0) {
            const canWrite = fileStream.write(chunk.subarray(offset, offset + bytesToWrite))
            bytesReceivedForCurrentFile += bytesToWrite
            totalBytesReceived += bytesToWrite
            offset += bytesToWrite

            const incoming = activeIncomingTransfers.get(transferId)
            if (incoming) {
              incoming.totalBytesReceived = totalBytesReceived
            }

            const now = Date.now()
            if (now - lastIpcTime > 150 || totalBytesReceived === totalSize) {
              lastIpcTime = now
              if (mainWindow) {
                mainWindow.webContents.send('transfer-progress', {
                  id: transferId,
                  direction: 'incoming',
                  progress: totalSize > 0 ? totalBytesReceived / totalSize : 1,
                  speed: 0,
                  bytesTransferred: totalBytesReceived,
                  totalSize
                })
              }
            }

            if (!canWrite) {
              socket.pause()
              fileStream.once('drain', () => {
                socket.resume()
              })
            }
          }

          if (bytesReceivedForCurrentFile >= currentFileExpectedSize) {
            const streamToClose = fileStream
            fileStream = null
            streamToClose.end()

            // Reply with per-file ACK
            socket.write(JSON.stringify({ type: 'file-ack', fileIndex: currentFileIndex, success: true }) + '\n')
            currentFileIndex++

            if (currentFileIndex >= filesMetadata.length) {
              // All files in this task have completed
              socket.write(JSON.stringify({ status: 'complete' }) + '\n')
              isSocketEnded = true
              socket.destroy()
              activeIncomingTransfers.delete(transferId)
              return
            }
          }
        } else {
          // Accumulate into controlBuffer to parse headers
          controlBuffer = Buffer.concat([controlBuffer, chunk.subarray(offset)])
          offset = chunk.length // All remaining bytes of current chunk consumed into controlBuffer

          let processed = true
          while (processed && !fileStream && controlBuffer.length >= 4 && !isSocketEnded) {
            processed = false
            const payloadLength = controlBuffer.readInt32BE(0)

            if (payloadLength <= 0 || payloadLength > 1024 * 1024) {
              console.error('Invalid payload length:', payloadLength)
              isSocketEnded = true
              socket.destroy()
              return
            }

            if (controlBuffer.length < 4 + payloadLength) {
              break // Incomplete header, wait for next chunk
            }

            const payloadStr = controlBuffer.subarray(4, 4 + payloadLength).toString('utf-8')
            controlBuffer = controlBuffer.subarray(4 + payloadLength)
            processed = true

            if (!isAccepted) {
              let metadata: any
              try {
                metadata = JSON.parse(payloadStr)
              } catch (e) {
                console.error('Failed to parse metadata handshake:', e)
                socket.write(JSON.stringify({ status: 'error', message: 'Invalid handshake' }) + '\n')
                isSocketEnded = true
                socket.destroy()
                return
              }

              if (metadata.type === 'ping') {
                const pongPayload = JSON.stringify({
                  status: 'pong',
                  nickname: myNickname,
                  avatarIndex: myAvatarIndex
                }) + '\n'
                socket.write(pongPayload)
                isSocketEnded = true
                socket.destroy()

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
                        progress: incoming.totalSize > 0 ? incoming.totalBytesReceived / incoming.totalSize : 0,
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
                        progress: incoming.totalSize > 0 ? incoming.totalBytesReceived / incoming.totalSize : 0,
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
                isSocketEnded = true
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
                socket.write(JSON.stringify({ status: 'accepted' }) + '\n')
                return
              }

              filesMetadata = metadata.files || []
              activeIncomingTransfers.set(transferId, {
                socket,
                files: filesMetadata,
                senderName,
                senderIp,
                isPaused: false,
                totalBytesReceived: 0,
                totalSize
              })

              if (mainWindow) {
                mainWindow.webContents.send('incoming-transfer', {
                  id: transferId,
                  senderName,
                  files: filesMetadata,
                  totalSize
                })
              }
              isAccepted = true
            } else {
              // In accepted state: parsing incoming file header
              let fileHeader: any
              try {
                fileHeader = JSON.parse(payloadStr)
              } catch (e) {
                console.error('Failed to parse file header:', e)
                isSocketEnded = true
                socket.destroy()
                return
              }

              const relativePath = fileHeader.relPath || `file_${currentFileIndex}`
              currentFileExpectedSize = fileHeader.size ?? 0
              bytesReceivedForCurrentFile = 0

              const normalizedPath = relativePath.replace(/\\/g, '/')
              const safeName = path.basename(normalizedPath)
              const destPath = path.join(saveDir, safeName)
              const destDir = path.dirname(destPath)
              if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true })
              }

              fileStream = fs.createWriteStream(destPath, { highWaterMark: 512 * 1024 })

              if (currentFileExpectedSize === 0) {
                fileStream.end()
                fileStream = null
                socket.write(JSON.stringify({ type: 'file-ack', fileIndex: currentFileIndex, success: true }) + '\n')
                currentFileIndex++

                if (currentFileIndex >= filesMetadata.length) {
                  socket.write(JSON.stringify({ status: 'complete' }) + '\n')
                  isSocketEnded = true
                  socket.destroy()
                  activeIncomingTransfers.delete(transferId)
                  return
                }
              } else if (controlBuffer.length > 0) {
                // Critical zero-loss fix: remaining bytes in controlBuffer belong to current file payload
                const remaining = controlBuffer
                controlBuffer = Buffer.alloc(0)
                processChunk(remaining)
              }
            }
          }
        }
      }
    }

    socket.on('data', (chunk) => {
      if (isSpeedTest) {
        totalBytesReceived += chunk.length
        if (totalBytesReceived >= totalSize) {
          socket.write(JSON.stringify({ status: 'complete' }) + '\n')
          isSocketEnded = true
          socket.destroy()
        }
        return
      }

      processChunk(chunk)
    })

    socket.on('error', (err) => {
      console.error('Receiver Socket error:', err)
      isSocketEnded = true
      if (fileStream) fileStream.end()
      if (transferId) activeIncomingTransfers.delete(transferId)
    })

    socket.on('close', () => {
      isSocketEnded = true
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
    incoming.socket.write(JSON.stringify({ status: 'accepted' }) + '\n')
  } else {
    incoming.socket.write(JSON.stringify({ status: 'declined' }) + '\n')
    incoming.socket.destroy()
    activeIncomingTransfers.delete(id)
  }
  return true
})

ipcMain.handle('start-speed-test', async (_event, { targetIp }: { targetIp: string }) => {
  const cleanIp = (targetIp || '').replace('::ffff:', '').trim()
  // 1. Check if target is a mobile web client
  const isMobilePeer = Array.from(activePeers.values()).some(p => p.ip === cleanIp && ((p as any).isMobile || p.port === 12139)) || webServer.hasClient(cleanIp)
  if (isMobilePeer) {
    return webServer.startMobileSpeedTest(cleanIp, (prog) => {
      if (mainWindow) {
        mainWindow.webContents.send('transfer-progress', prog)
      }
    })
  }

  // 2. PC-to-PC Multi-Socket Concurrent Speed Test (4 parallel streams for max WiFi 6 saturation)
  return new Promise((resolve) => {
    const NUM_STREAMS = 4
    const totalSize = 120 * 1024 * 1024 // 120MB
    const subSize = Math.floor(totalSize / NUM_STREAMS)
    const transferId = `speedtest-${Date.now()}`
    let totalBytesSent = 0
    let streamsCompleted = 0
    let lastIpcTime = 0
    let startTime = 0
    let hasFailed = false

    const sockets: net.Socket[] = []

    for (let i = 0; i < NUM_STREAMS; i++) {
      const socket = new net.Socket()
      sockets.push(socket)
      let streamBytesSent = 0

      socket.connect(PORT, cleanIp, () => {
        socket.setNoDelay(true)
        const handshake = JSON.stringify({
          type: 'speed-test',
          id: `${transferId}-${i}`,
          senderName: myNickname,
          totalSize: subSize
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
          return
        }

        if (response.status === 'accepted') {
          if (!startTime) startTime = Date.now()
          const testChunk = Buffer.alloc(512 * 1024) // 512KB for smooth TCP pipeline

          const pump = () => {
            if (streamBytesSent >= subSize || hasFailed) return
            const payload = testChunk.subarray(0, Math.min(testChunk.length, subSize - streamBytesSent))
            const canWrite = socket.write(payload)
            streamBytesSent += payload.length
            totalBytesSent += payload.length

            const now = Date.now()
            if (now - lastIpcTime > 120 || totalBytesSent >= totalSize) {
              lastIpcTime = now
              const elapsed = (now - startTime) / 1000 || 0.05
              const currentMbps = ((totalBytesSent * 8) / 1024 / 1024) / elapsed
              if (mainWindow) {
                mainWindow.webContents.send('transfer-progress', {
                  id: transferId,
                  direction: 'outgoing',
                  isSpeedTest: true,
                  progress: Math.min(1, totalBytesSent / totalSize),
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
          streamsCompleted++
          socket.destroy()
          if (streamsCompleted >= NUM_STREAMS && !hasFailed) {
            const duration = (Date.now() - startTime) / 1000 || 0.05
            const avgMbps = ((totalBytesSent * 8) / 1024 / 1024) / duration
            resolve({ success: true, speedMbps: avgMbps })
          }
        }
      })

      socket.on('error', (err) => {
        if (!hasFailed) {
          hasFailed = true
          sockets.forEach(s => s.destroy())
          // Fallback: If port 12138 is refused, check if target is a mobile client on webServer
          if ((err.message.includes('ECONNREFUSED') || (err as any).code === 'ECONNREFUSED') && (webServer.hasClient(cleanIp) || webServer.getIsRunning())) {
            webServer.startMobileSpeedTest(cleanIp, (prog) => {
              if (mainWindow) {
                mainWindow.webContents.send('transfer-progress', prog)
              }
            }).then(resolve)
            return
          }
          let errorMsg = err.message
          if (err.message.includes('ECONNREFUSED')) {
            errorMsg = `连接被拒绝 (${cleanIp}:12138)。若目标为手机，请先扫码打开快传网页后再测速`
          }
          resolve({ success: false, error: errorMsg })
        }
      })
    }
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
    let currentFileAckResolver: (() => void) | null = null
    let responseLineBuffer = ''

    const resolveWithCleanup = (val: any) => {
      if (resolved) return
      resolved = true
      currentFileAckResolver = null
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
      responseLineBuffer += data.toString('utf-8')
      const lines = responseLineBuffer.split('\n')
      responseLineBuffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue

        let response: any
        try {
          response = JSON.parse(line)
        } catch (e) {
          console.error('Failed to parse sender response line:', line, e)
          continue
        }

        if (response.status === 'accepted') {
          // Start streaming files sequentially
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            try {
              await sendSingleFile(socket, file, i)
            } catch (e) {
              console.error('File stream error:', e)
              socket.destroy()
              resolveWithCleanup({ success: false, error: 'Transmission interrupted' })
              return
            }
          }
        } else if (response.type === 'file-ack') {
          if (currentFileAckResolver) {
            const resolver = currentFileAckResolver
            currentFileAckResolver = null
            resolver()
          }
        } else if (response.status === 'declined') {
          socket.destroy()
          resolveWithCleanup({ success: false, error: 'Rejected by receiver' })
        } else if (response.status === 'complete') {
          socket.destroy()
          resolveWithCleanup({ success: true })
        }
      }
    })

    function sendSingleFile(clientSocket: net.Socket, file: TransferFile, fileIndex: number): Promise<void> {
      return new Promise((resolveFile, rejectFile) => {
        let ackTimeout: NodeJS.Timeout | null = null

        const cleanupAndResolve = () => {
          if (ackTimeout) {
            clearTimeout(ackTimeout)
            ackTimeout = null
          }
          currentFileAckResolver = null
          resolveFile()
        }

        currentFileAckResolver = cleanupAndResolve

        // Safety fallback timeout (30 seconds)
        ackTimeout = setTimeout(() => {
          console.warn(`File ACK timeout for file [${file.name}], proceeding with fallback`)
          cleanupAndResolve()
        }, 30000)

        // 1. Send file header with 4-byte BE length prefix
        const header = JSON.stringify({ relPath: file.name, size: file.size, fileIndex })
        const lenBuf = Buffer.alloc(4)
        lenBuf.writeInt32BE(Buffer.byteLength(header))
        clientSocket.write(Buffer.concat([lenBuf, Buffer.from(header, 'utf-8')]))

        // Handle 0-byte file edge case
        if (file.size === 0) {
          return
        }

        // 2. Stream file data with 512KB chunk buffer for optimal TCP pipeline throughput
        const readStream = fs.createReadStream(file.path, { highWaterMark: 512 * 1024 })
        
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
                progress: totalSize > 0 ? totalBytesSent / totalSize : 1,
                speed: 0, // Calculated in frontend
                bytesTransferred: totalBytesSent,
                totalSize
              })
            }
          }

          // Backpressure to socket
          const canWrite = clientSocket.write(chunk)
          if (!canWrite) {
            readStream.pause()
            clientSocket.once('drain', () => {
              readStream.resume()
            })
          }
        })

        readStream.on('end', () => {
          // Stream read finished. Waiting for receiver's file-ack to invoke currentFileAckResolver.
        })

        readStream.on('error', (err) => {
          if (ackTimeout) clearTimeout(ackTimeout)
          currentFileAckResolver = null
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
  // 1. Check if it is an active mobile web upload
  const isMobileHandled = webServer.cancelUpload(id)
  if (isMobileHandled) {
    return true
  }

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
