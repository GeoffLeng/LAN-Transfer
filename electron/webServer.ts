import * as http from 'http'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { EventEmitter } from 'events'

export interface WebFileItem {
  id: string
  name: string
  size: number
  path: string
  senderName: string
  targetIp?: string
  time: number
}

interface SseClient {
  res: http.ServerResponse
  ip: string
}

class WebServerManager extends EventEmitter {
  private server: http.Server | null = null
  private port = 12139
  private isRunning = false
  private sseClients: Set<SseClient> = new Set()
  private pendingDownloads = new Map<string, WebFileItem>()
  private saveDir = path.join(os.homedir(), 'Downloads')
  private getMyInfoCallback: () => { nickname: string; ip: string; avatarIndex: number } = () => ({
    nickname: 'Desktop',
    ip: '127.0.0.1',
    avatarIndex: 0
  })
  private getPeersCallback: () => any[] = () => []

  public setCallbacks(
    infoCb: () => { nickname: string; ip: string; avatarIndex: number },
    peersCb: () => any[],
    getSaveDirCb: () => string
  ) {
    this.getMyInfoCallback = infoCb
    this.getPeersCallback = peersCb
    this.saveDir = getSaveDirCb()
  }

  public updateSaveDir(dir: string) {
    this.saveDir = dir
  }

  public start(port = 12139): Promise<number> {
    this.port = port
    return new Promise((resolve, reject) => {
      if (this.isRunning && this.server) {
        return resolve(this.port)
      }

      this.server = http.createServer((req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-Target-Ip, X-Sender-Name, X-File-Size')

        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

        // 1. SSE Events Endpoint
        if (url.pathname === '/api/events') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          })
          res.write('retry: 3000\n\n')

          const rawIp = req.socket.remoteAddress || ''
          const clientIp = rawIp.replace('::ffff:', '')
          const sseItem: SseClient = { res, ip: clientIp }

          this.sseClients.add(sseItem)

          if (clientIp && clientIp !== '127.0.0.1') {
            this.emit('mobile-peer-register', { ip: clientIp })
          }

          // Heartbeat timer (3s) to prevent peer expiration in desktop discovery
          const heartbeatInterval = setInterval(() => {
            res.write(':heartbeat\n\n')
            if (clientIp && clientIp !== '127.0.0.1') {
              this.emit('mobile-peer-heartbeat', { ip: clientIp })
            }
          }, 3000)

          // Strict filter: Only downloads specifically targeting this clientIp
          const filteredDownloads = Array.from(this.pendingDownloads.values()).filter(
            f => f.targetIp === clientIp
          )

          // Send initial info, clientIp & peers
          const initialData = JSON.stringify({
            type: 'init',
            clientIp: clientIp,
            desktop: this.getMyInfoCallback(),
            peers: this.getPeersCallback(),
            downloads: filteredDownloads
          })
          res.write(`data: ${initialData}\n\n`)

          req.on('close', () => {
            clearInterval(heartbeatInterval)
            this.sseClients.delete(sseItem)
            if (clientIp && clientIp !== '127.0.0.1') {
              this.emit('mobile-peer-unregister', { ip: clientIp })
            }
          })
          return
        }

        // 2. Info & Peers API
        if (url.pathname === '/api/info') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            desktop: this.getMyInfoCallback(),
            peers: this.getPeersCallback()
          }))
          return
        }

        // 3. Update Nickname API
        if (url.pathname === '/api/nickname' && req.method === 'POST') {
          let body = ''
          req.on('data', chunk => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const rawIp = req.socket.remoteAddress || ''
              const clientIp = rawIp.replace('::ffff:', '')
              if (data.nickname && clientIp) {
                this.emit('mobile-peer-update', { ip: clientIp, nickname: data.nickname })
              }
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } catch (e) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false }))
            }
          })
          return
        }

        // Speedtest Endpoint (Exclude Disk I/O, pure RAM transmission)
        if (url.pathname === '/api/speedtest') {
          if (req.method === 'POST') {
            let totalBytes = 0
            req.on('data', chunk => { totalBytes += chunk.length })
            req.on('end', () => {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, received: totalBytes }))
            })
            req.on('error', () => {
              res.writeHead(500)
              res.end()
            })
          } else if (req.method === 'GET' || req.method === 'HEAD') {
            const totalSize = 50 * 1024 * 1024 // 50MB
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Content-Length': totalSize.toString()
            })
            if (req.method === 'HEAD') {
              res.end()
              return
            }

            const zeroChunk = Buffer.alloc(1024 * 1024 * 2) // 2MB
            let bytesSent = 0
            
            const pump = () => {
              if (bytesSent >= totalSize) {
                res.end()
                return
              }
              const chunkToSend = zeroChunk.subarray(0, Math.min(zeroChunk.length, totalSize - bytesSent))
              const canWrite = res.write(chunkToSend)
              bytesSent += chunkToSend.length

              if (canWrite) {
                process.nextTick(pump)
              } else {
                res.once('drain', pump)
              }
            }
            pump()
          }
          return
        }

        // 4. Upload Endpoint (Mobile -> Desktop / Relay)
        if (url.pathname === '/api/upload' && req.method === 'POST') {
          this.handleUpload(req, res)
          return
        }

        // 5. Download Endpoint (Mobile Download File)
        if (url.pathname.startsWith('/api/download/')) {
          const fileId = url.pathname.replace('/api/download/', '')
          this.handleDownload(fileId, res)
          return
        }

        // 6. Serve HTML Web UI
        if (url.pathname === '/' || url.pathname === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(this.getMobileHtmlPage())
          return
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      })

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`Port ${this.port} in use, trying ${this.port + 1}...`)
          this.port++
          this.server?.listen(this.port)
        } else {
          reject(err)
        }
      })

      this.server.listen(this.port, () => {
        this.isRunning = true
        console.log(`Web Server listening on http://0.0.0.0:${this.port}`)
        resolve(this.port)
      })
    })
  }

  public stop() {
    if (this.server) {
      for (const client of this.sseClients) {
        client.res.end()
      }
      this.sseClients.clear()
      this.server.close()
      this.server = null
      this.isRunning = false
    }
  }

  public broadcastPeers(peers: any[]) {
    this.broadcastEvent({ type: 'peers-update', peers })
  }

  public broadcastEvent(data: any) {
    const payload = `data: ${JSON.stringify(data)}\n\n`
    for (const client of this.sseClients) {
      client.res.write(payload)
    }
  }

  // Desktop or Mobile sends file via Web Download (Targets specific phone only)
  public addPendingDownload(file: WebFileItem) {
    this.pendingDownloads.set(file.id, file)
    const payload = `data: ${JSON.stringify({ type: 'new-download', file })}\n\n`

    for (const client of this.sseClients) {
      if (file.targetIp && client.ip === file.targetIp) {
        client.res.write(payload)
      }
    }
  }

  private handleUpload(req: http.IncomingMessage, res: http.ServerResponse) {
    const rawFileName = (req.headers['x-file-name'] as string) || `upload_${Date.now()}.bin`
    const fileName = decodeURIComponent(rawFileName)
    const senderName = decodeURIComponent((req.headers['x-sender-name'] as string) || '手机用户')
    const targetIp = (req.headers['x-target-ip'] as string) || ''
    const fileSize = parseInt((req.headers['x-file-size'] as string) || '0', 10)

    // Security: sanitize path basename
    const safeName = path.basename(fileName.replace(/\\/g, '/'))
    const currentSaveDir = this.saveDir || path.join(os.homedir(), 'Downloads')
    
    if (!fs.existsSync(currentSaveDir)) {
      fs.mkdirSync(currentSaveDir, { recursive: true })
    }

    const destPath = path.join(currentSaveDir, safeName)
    const writeStream = fs.createWriteStream(destPath, { highWaterMark: 1024 * 1024 * 4 })

    let received = 0
    let lastIpcTime = 0
    const transferId = `mobile-${Date.now()}-${Math.floor(Math.random() * 1000)}`

    const desktopInfo = this.getMyInfoCallback()
    const isTargetingDesktop = !targetIp || targetIp === desktopInfo.ip

    // Notify Desktop UI of incoming stream only if desktop is the recipient
    if (isTargetingDesktop) {
      this.emit('mobile-upload-start', {
        id: transferId,
        senderName,
        fileName: safeName,
        totalSize: fileSize
      })
    }

    req.on('data', (chunk) => {
      received += chunk.length
      writeStream.write(chunk)

      if (isTargetingDesktop) {
        const now = Date.now()
        if (now - lastIpcTime > 150 || received === fileSize) {
          lastIpcTime = now
          this.emit('mobile-upload-progress', {
            id: transferId,
            senderName,
            fileName: safeName,
            bytesTransferred: received,
            totalSize: fileSize,
            progress: fileSize > 0 ? received / fileSize : 1
          })
        }
      }
    })

    req.on('end', () => {
      writeStream.end()
      
      if (isTargetingDesktop) {
        this.emit('mobile-upload-complete', {
          id: transferId,
          senderName,
          fileName: safeName,
          path: destPath,
          totalSize: received
        })
      } else {
        // Mobile-to-Mobile transfer relay: Register for target mobile client
        const fileId = `web-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        this.addPendingDownload({
          id: fileId,
          name: safeName,
          size: received,
          path: destPath,
          senderName: senderName,
          targetIp: targetIp,
          time: Date.now()
        })
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, message: 'File uploaded successfully' }))
    })

    req.on('error', (err) => {
      console.error('Mobile upload error:', err)
      writeStream.end()
      this.emit('mobile-upload-error', { id: transferId, error: err.message })
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: err.message }))
    })
  }

  private handleDownload(fileId: string, res: http.ServerResponse) {
    const fileItem = this.pendingDownloads.get(fileId)
    if (!fileItem || !fs.existsSync(fileItem.path)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('文件不存在或已被删除')
      return
    }

    const stat = fs.statSync(fileItem.path)
    const encodedName = encodeURIComponent(fileItem.name)

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
    })

    const readStream = fs.createReadStream(fileItem.path)
    readStream.pipe(res)
  }

  public getPort(): number {
    return this.port
  }

  public getIsRunning(): boolean {
    return this.isRunning
  }

  private getMobileHtmlPage(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>LAN Transfer - 手机快传</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: #0f172a; color: #f8fafc; padding: 16px; min-height: 100vh; display: flex; flex-direction: column; }
    .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid #1e293b; margin-bottom: 16px; }
    .logo { font-size: 20px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px; }
    .status-badge { font-size: 12px; padding: 4px 8px; border-radius: 999px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
    .card { background: #1e293b; border-radius: 16px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155; }
    .card-title { font-size: 15px; font-weight: 600; color: #94a3b8; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
    .nickname-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; background: #1e293b; padding: 8px 12px; border-radius: 12px; border: 1px solid #334155; }
    .nickname-input { background: transparent; border: none; color: #f8fafc; font-size: 14px; flex: 1; outline: none; }
    .save-name-btn { background: #38bdf8; color: #0f172a; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .save-name-btn:active { scale: 0.95; }
    .device-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .device-card { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: #0f172a; border-radius: 10px; border: 1px solid #334155; cursor: pointer; transition: background 0.15s; }
    .device-card:active { background: rgba(56, 189, 248, 0.1); }
    .device-info { display: flex; align-items: center; gap: 10px; }
    .device-icon { font-size: 20px; }
    .device-name { font-size: 14px; font-weight: 600; color: #f1f5f9; }
    .device-ip { font-size: 12px; color: #38bdf8; font-family: monospace; }
    .send-icon-btn { background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; }
    .file-input { display: none; }
    .progress-bar { width: 100%; height: 8px; background: #334155; border-radius: 4px; overflow: hidden; margin-top: 10px; }
    .progress-fill { height: 100%; background: #38bdf8; width: 0%; transition: width 0.1s linear; }
    .item-list { display: flex; flex-direction: column; gap: 8px; }
    .item-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: #0f172a; border-radius: 8px; border: 1px solid #334155; }
    .item-info { display: flex; flex-direction: column; overflow: hidden; margin-right: 8px; }
    .item-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #f1f5f9; }
    .item-meta { font-size: 12px; color: #64748b; margin-top: 2px; }
    .download-btn { background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; }
    .tip { font-size: 12px; color: #64748b; text-align: center; margin-top: auto; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">⚡ LAN Transfer 手机版</div>
    <div id="connectionStatus" class="status-badge">连接中...</div>
  </div>

  <div class="nickname-bar">
    <span style="font-size:16px;">📱</span>
    <span style="font-size:13px; color:#94a3b8;">手机名字:</span>
    <input type="text" id="nicknameInput" class="nickname-input" value="手机用户">
    <button class="save-name-btn" onclick="saveNickname()">保存</button>
  </div>

  <div class="card">
    <div class="card-title">
      <span>📡 局域网在线设备列表</span>
      <span style="font-size:11px; font-weight:normal; color:#64748b;">点击设备发送文件</span>
    </div>
    <div id="deviceList" class="device-grid">
      <div style="font-size:13px; color:#64748b; text-align:center; padding:12px;">正在搜索局域网设备...</div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">
      <span>🚀 局域网通道测速</span>
      <span style="font-size:11px; font-weight:normal; color:#64748b;">测试手机与电脑间网速</span>
    </div>
    <div style="display:flex; gap:8px;">
      <button onclick="runUploadSpeedTest()" style="flex:1; background:rgba(56,189,248,0.1); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:8px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;">测试上传网速</button>
      <button onclick="runDownloadSpeedTest()" style="flex:1; background:rgba(16,185,129,0.1); color:#10b981; border:1px solid rgba(16,185,129,0.3); padding:8px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;">测试下载网速</button>
    </div>
    <div id="speedResult" style="margin-top:12px; font-size:13px; text-align:center; color:#94a3b8; display:none; background:#0f172a; padding:8px; border-radius:8px; border:1px solid #334155;"></div>
  </div>

  <input type="file" id="fileInput" class="file-input" multiple onchange="uploadFiles(this.files)">

  <div id="uploadProgressCard" class="card" style="display:none;">
    <div class="card-title">📤 正在发送文件</div>
    <div style="display:flex; justify-content:space-between; font-size:12px; color:#94a3b8;">
      <span id="uploadFileName">上传中...</span>
      <span id="uploadPercent">0%</span>
    </div>
    <div class="progress-bar"><div id="progressFill" class="progress-fill"></div></div>
  </div>

  <div class="card">
    <div class="card-title">📥 可下载文件</div>
    <div id="downloadList" class="item-list">
      <div style="font-size:13px; color:#64748b; text-align:center; padding:12px;">暂无待下载文件</div>
    </div>
  </div>

  <div class="tip">💡 提示：点击上方的在线设备即可选择文件即时发送</div>

  <script>
    let myNickname = localStorage.getItem('mobile_nickname') || ('手机_' + Math.floor(Math.random() * 899 + 100));
    document.getElementById('nicknameInput').value = myNickname;

    let myClientIp = '';
    let targetDeviceIp = '';
    let desktopInfo = null;
    let peersList = [];
    let downloadsMap = new Map();

    const evtSource = new EventSource('/api/events');
    const statusBadge = document.getElementById('connectionStatus');
    const deviceListEl = document.getElementById('deviceList');
    const downloadListEl = document.getElementById('downloadList');

    evtSource.onopen = () => {
      statusBadge.textContent = '🟢 在线';
      statusBadge.style.color = '#34d399';
      statusBadge.style.borderColor = 'rgba(52, 211, 153, 0.3)';
      saveNickname(true);
    };

    evtSource.onerror = () => {
      statusBadge.textContent = '🔴 离线';
      statusBadge.style.color = '#f87171';
      statusBadge.style.borderColor = 'rgba(248, 113, 113, 0.3)';
    };

    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'init') {
          if (data.clientIp) myClientIp = data.clientIp;
          desktopInfo = data.desktop;
          peersList = data.peers || [];
          if (data.downloads) {
            data.downloads.forEach(item => downloadsMap.set(item.id, item));
          }
          renderDevices();
          renderDownloads();
        } else if (data.type === 'peers-update') {
          peersList = data.peers || [];
          renderDevices();
        } else if (data.type === 'new-download') {
          downloadsMap.set(data.file.id, data.file);
          renderDownloads();
          if (navigator.vibrate) navigator.vibrate(200);
        }
      } catch (err) { console.error(err); }
    };

    function saveNickname(silent = false) {
      const val = document.getElementById('nicknameInput').value.trim();
      if (!val) return;
      myNickname = val;
      localStorage.setItem('mobile_nickname', myNickname);

      fetch('/api/nickname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: myNickname })
      }).then(() => {
        if (!silent) alert('名称已保存并同步给电脑！');
      }).catch(err => console.error(err));
    }

    function renderDevices() {
      deviceListEl.innerHTML = '';
      const allDevices = [];

      if (desktopInfo) {
        allDevices.push({
          name: desktopInfo.nickname + ' (电脑)',
          ip: desktopInfo.ip,
          type: 'desktop'
        });
      }

      peersList.forEach(p => {
        allDevices.push({
          name: p.name,
          ip: p.ip,
          type: p.isMobile ? 'mobile' : 'desktop'
        });
      });

      if (allDevices.length === 0) {
        deviceListEl.innerHTML = '<div style="font-size:13px; color:#64748b; text-align:center; padding:12px;">未在局域网中找到其他在线设备</div>';
        return;
      }

      allDevices.forEach(dev => {
        const isSelf = (myClientIp && dev.ip === myClientIp);
        const card = document.createElement('div');
        card.className = 'device-card';
        if (isSelf) {
          card.style.opacity = '0.75';
          card.style.cursor = 'default';
        } else {
          card.onclick = () => selectDeviceToSend(dev.ip);
        }

        const btnHtml = isSelf
          ? '<div style="background:#334155; color:#94a3b8; border:1px solid #475569; padding:4px 10px; border-radius:6px; font-size:12px;">本设备</div>'
          : '<div class="send-icon-btn">发送文件</div>';

        const displayName = isSelf ? (escapeHtml(dev.name) + ' (本设备)') : escapeHtml(dev.name);

        card.innerHTML = \`
          <div class="device-info">
            <div class="device-icon">\${dev.type === 'desktop' ? '💻' : '📱'}</div>
            <div>
              <div class="device-name">\${displayName}</div>
              <div class="device-ip">\${dev.ip}</div>
            </div>
          </div>
          \${btnHtml}
        \`;
        deviceListEl.appendChild(card);
      });
    }

    function selectDeviceToSend(ip) {
      targetDeviceIp = ip;
      document.getElementById('fileInput').click();
    }

    function renderDownloads() {
      if (downloadsMap.size === 0) {
        downloadListEl.innerHTML = '<div style="font-size:13px; color:#64748b; text-align:center; padding:12px;">暂无待下载文件</div>';
        return;
      }
      downloadListEl.innerHTML = '';
      downloadsMap.forEach(item => {
        const row = document.createElement('div');
        row.className = 'item-row';
        row.innerHTML = \`
          <div class="item-info">
            <div class="item-name">\${escapeHtml(item.name)}</div>
            <div class="item-meta">\${formatSize(item.size)} · 来自 \${escapeHtml(item.senderName || '电脑')}</div>
          </div>
          <a class="download-btn" href="/api/download/\${item.id}" download="\${escapeHtml(item.name)}">下载</a>
        \`;
        downloadListEl.appendChild(row);
      });
    }

    function uploadFiles(files) {
      if (!files || files.length === 0) return;
      const progressCard = document.getElementById('uploadProgressCard');
      const fileNameEl = document.getElementById('uploadFileName');
      const percentEl = document.getElementById('uploadPercent');
      const fillEl = document.getElementById('progressFill');

      progressCard.style.display = 'block';

      let queue = Array.from(files);
      function processNext() {
        if (queue.length === 0) {
          fileNameEl.textContent = '✅ 全部发送完成！';
          percentEl.textContent = '100%';
          fillEl.style.width = '100%';
          setTimeout(() => { progressCard.style.display = 'none'; }, 2500);
          return;
        }
        const file = queue.shift();
        fileNameEl.textContent = file.name;
        percentEl.textContent = '0%';
        fillEl.style.width = '0%';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload', true);
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('X-Sender-Name', encodeURIComponent(myNickname));
        xhr.setRequestHeader('X-Target-Ip', targetDeviceIp);
        xhr.setRequestHeader('X-File-Size', file.size.toString());

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            percentEl.textContent = percent + '%';
            fillEl.style.width = percent + '%';
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            processNext();
          } else {
            alert('上传失败: ' + file.name);
            progressCard.style.display = 'none';
          }
        };
        xhr.onerror = () => {
          alert('网络传输错误: ' + file.name);
          progressCard.style.display = 'none';
        };

        xhr.send(file);
      }
      processNext();
    }

    function formatSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeHtml(str) {
      return str.replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
      });
    }

    async function runUploadSpeedTest() {
      const el = document.getElementById('speedResult');
      el.style.display = 'block';
      el.innerHTML = '⚡ 正在上传测速中...';
      const dataSize = 25 * 1024 * 1024; // 25MB
      const data = new Blob([new Uint8Array(dataSize)]);
      const startTime = Date.now();
      try {
        await fetch('/api/speedtest', { method: 'POST', body: data });
        const duration = (Date.now() - startTime) / 1000 || 0.1;
        const speed = (dataSize / 1024 / 1024) / duration;
        el.innerHTML = '📤 上传速度：<strong>' + speed.toFixed(1) + ' MB/s</strong> (约 ' + (speed * 8).toFixed(0) + ' Mbps)';
      } catch (e) {
        el.innerHTML = '❌ 测速失败，请检查网络';
      }
    }

    async function runDownloadSpeedTest() {
      const el = document.getElementById('speedResult');
      el.style.display = 'block';
      el.innerHTML = '⚡ 正在下载测速中...';
      const startTime = Date.now();
      let loaded = 0;
      try {
        const res = await fetch('/api/speedtest');
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          loaded += value.length;
        }
        const duration = (Date.now() - startTime) / 1000 || 0.1;
        const speed = (loaded / 1024 / 1024) / duration;
        el.innerHTML = '📥 下载速度：<strong>' + speed.toFixed(1) + ' MB/s</strong> (约 ' + (speed * 8).toFixed(0) + ' Mbps)';
      } catch (e) {
        el.innerHTML = '❌ 测速失败，请检查网络';
      }
    }
  </script>
</body>
</html>`
  }
}

export const webServer = new WebServerManager()
