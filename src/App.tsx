import { useEffect, useState, useRef } from 'react'
import { Sidebar } from './components/Sidebar'
import { Radar } from './components/Radar'
import { FileList } from './components/FileList'
import { DynamicIsland } from './components/DynamicIsland'
import { 
  FileText, 
  Check, 
  ArrowRightLeft, 
  Laptop, 
  CheckCircle, 
  XCircle,
  History as HistoryIcon,
  Play,
  Pause
} from 'lucide-react'
import { ShibaAvatar } from './components/ShibaAvatar'

// TS interface definitions for electron API
declare global {
  interface Window {
    electronAPI: {
      selectFiles: () => Promise<{ path: string; name: string; size: number }[]>;
      sendFiles: (targetIp: string, files: { path: string; name: string; size: number }[], transferId: string) => Promise<{ success: boolean; error?: string }>;
      acceptTransfer: (id: string, accept: boolean) => Promise<boolean>;
      getMyNickname: () => Promise<string>;
      setMyNickname: (nickname: string) => Promise<string>;
      getMyIp: () => Promise<string>;
      getMyAvatarIndex: () => Promise<number>;
      setMyAvatarIndex: (idx: number) => Promise<number>;
      minimizeWindow: () => void;
      maximizeWindow: () => void;
      closeWindow: () => void;
      selectDirectory: () => Promise<string | null>;
      getSaveDir: () => Promise<string>;
      setSaveDir: (dir: string) => Promise<string>;
      pauseTransfer: (id: string) => Promise<boolean>;
      resumeTransfer: (id: string) => Promise<boolean>;
      cancelTransfer: (id: string) => Promise<boolean>;
      onDeviceListUpdate: (callback: (devices: any[]) => void) => () => void;
      onTransferProgress: (callback: (data: any) => void) => () => void;
      onIncomingTransfer: (callback: (data: { id: string; senderName: string; files: any[]; totalSize: number }) => void) => () => void;
    }
  }
}

interface SelectedFile {
  path: string
  name: string
  size: number
}

interface Device {
  id: string
  name: string
  ip: string
  port: number
  avatarIndex: number
}

interface TransferRecord {
  id: string
  fileName: string
  totalSize: number
  peerName: string
  direction: 'incoming' | 'outgoing'
  status: 'completed' | 'failed' | 'declined' | 'cancelled'
  time: string
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const formatSpeed = (bytesPerSec: number): string => {
  return formatSize(bytesPerSec) + '/s'
}

const formatRemainingTime = (totalSeconds: number): string => {
  if (totalSeconds < 60) {
    return `${totalSeconds} 秒`
  }
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'send' | 'history' | 'settings' | 'transferring'>('send')
  const [devices, setDevices] = useState<Device[]>([])
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  
  const [myNickname, setMyNickname] = useState('')
  const [tempNickname, setTempNickname] = useState('')
  const [myAvatarIndex, setMyAvatarIndex] = useState(0)
  const [myIp, setMyIp] = useState('127.0.0.1')
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  })
  
  // Transfers states
  const [incomingTransfer, setIncomingTransfer] = useState<{ id: string; senderName: string; files: any[]; totalSize: number } | null>(null)
  const [transferState, setTransferState] = useState<any>(null)
  const [history, setHistory] = useState<TransferRecord[]>([])
  const [saveDir, setSaveDir] = useState('Downloads (下载) 目录')

  // Tracking speed calculations
  const lastTimeRef = useRef(Date.now())
  const lastBytesRef = useRef(0)
  const lastSpeedRef = useRef(0)
  const cancelledIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // 1. Fetch info
    window.electronAPI.getMyNickname().then(name => {
      setMyNickname(name)
      setTempNickname(name)
    })
    window.electronAPI.getMyIp().then(ip => setMyIp(ip))
    window.electronAPI.getSaveDir().then(dir => setSaveDir(dir))
    window.electronAPI.getMyAvatarIndex().then(idx => setMyAvatarIndex(idx))

    // 2. Setup mDNS peer updates
    const unsubscribeDevices = window.electronAPI.onDeviceListUpdate((peerList) => {
      setDevices(peerList)
    })

    // 3. Setup incoming transfer request listener
    const unsubscribeIncoming = window.electronAPI.onIncomingTransfer((data) => {
      setIncomingTransfer(data)
    })

    // 4. Setup progress listener
    const unsubscribeProgress = window.electronAPI.onTransferProgress((data) => {
      // Skip ALL events for transfers that have been cancelled
      if (cancelledIdsRef.current.has(data.id)) {
        return
      }

      if (data.status === 'cancelled') {
        cancelledIdsRef.current.add(data.id)
        handleTransferComplete({
          id: data.id,
          direction: data.direction,
          totalSize: data.totalSize
        }, 'cancelled')
        if (data.direction === 'incoming') {
          setTimeout(() => {
            alert(`传输方（${data.senderName || '对方'}）中止传输`)
          }, 50)
        }
        return
      }

      const now = Date.now()
      const timeDelta = (now - lastTimeRef.current) / 1000 // seconds
      const targetBytes = data.bytesTransferred !== undefined ? data.bytesTransferred : lastBytesRef.current
      const bytesDelta = targetBytes - lastBytesRef.current

      let calculatedSpeed = lastSpeedRef.current
      if (timeDelta > 0.2 && !data.isPaused) {
        calculatedSpeed = bytesDelta / timeDelta
        lastTimeRef.current = now
        lastBytesRef.current = targetBytes
        lastSpeedRef.current = calculatedSpeed
      }

      setTransferState((prev: any) => {
        const isCurrentlyPaused = data.isPaused !== undefined ? data.isPaused : (prev && prev.status === 'paused')
        const currentSpeed = isCurrentlyPaused ? 0 : calculatedSpeed
        const currentStatus = isCurrentlyPaused ? 'paused' : (data.direction === 'outgoing' ? 'sending' : 'receiving')
        return {
          id: data.id,
          direction: data.direction,
          progress: data.progress !== undefined ? data.progress : (prev?.progress || 0),
          speed: currentSpeed,
          bytesTransferred: targetBytes,
          totalSize: data.totalSize !== undefined ? data.totalSize : (prev?.totalSize || 0),
          status: currentStatus,
          peerName: prev?.peerName || '设备'
        }
      })

      // Complete or fail states
      if (data.progress !== undefined && data.progress >= 1) {
        handleTransferComplete(data, 'completed')
      }
    })

    return () => {
      unsubscribeDevices()
      unsubscribeIncoming()
      unsubscribeProgress()
    }
  }, [])

  const handleTransferComplete = (data: any, status: 'completed' | 'failed' | 'declined' | 'cancelled') => {
    // Skip if this transfer was already cancelled
    if (status !== 'cancelled' && cancelledIdsRef.current.has(data.id)) {
      return
    }

    // Add to history
    const isOutgoing = data.direction === 'outgoing'
    const newRecord: TransferRecord = {
      id: data.id,
      fileName: isOutgoing ? selectedFiles[0]?.name || '多个文件' : incomingTransfer?.files[0]?.name || '多个文件',
      totalSize: data.totalSize,
      peerName: isOutgoing ? selectedDevice?.name || '对端' : incomingTransfer?.senderName || '对端',
      direction: data.direction,
      status,
      time: new Date().toLocaleTimeString()
    }

    setHistory(prev => [newRecord, ...prev])

    if (status === 'cancelled') {
      // Immediately clear everything synchronously
      setTransferState(null)
      if (isOutgoing) {
        setSelectedDevice(null)
        setSelectedFiles([])
      } else {
        setIncomingTransfer(null)
      }
    } else {
      // Update status in Dynamic Island
      setTransferState((prev: any) => prev ? { ...prev, status } : null)

      // Clear after 3 seconds
      setTimeout(() => {
        setTransferState(null)
        if (isOutgoing) {
          setSelectedDevice(null)
          setSelectedFiles([])
        } else {
          setIncomingTransfer(null)
        }
      }, 3000)
    }

    lastBytesRef.current = 0
  }

  const handlePause = async () => {
    if (!transferState) return
    await window.electronAPI.pauseTransfer(transferState.id)
    setTransferState((prev: any) => prev ? { ...prev, status: 'paused' } : null)
  }

  const handleResume = async () => {
    if (!transferState) return
    await window.electronAPI.resumeTransfer(transferState.id)
    setTransferState((prev: any) => prev ? { ...prev, status: prev.direction === 'outgoing' ? 'sending' : 'receiving' } : null)
    lastTimeRef.current = Date.now()
  }

  const handleCancel = async () => {
    if (!transferState) return
    cancelledIdsRef.current.add(transferState.id)
    // Immediately close popup and record
    handleTransferComplete({
      id: transferState.id,
      direction: transferState.direction,
      totalSize: transferState.totalSize
    }, 'cancelled')
    await window.electronAPI.cancelTransfer(transferState.id)
  }

  // Click on a peer avatar to choose files
  const handleSelectDevice = async (device: Device) => {
    setSelectedDevice(device)
    const files = await window.electronAPI.selectFiles()
    if (files && files.length > 0) {
      setSelectedFiles(files)
    } else {
      setSelectedDevice(null)
    }
  }

  // Fallback Direct IP connection and file sending
  const handleDirectConnect = async (ip: string) => {
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/
    if (!ipRegex.test(ip.trim())) {
      alert('请输入有效的 IP 地址')
      return
    }

    const files = await window.electronAPI.selectFiles()
    if (files && files.length > 0) {
      setSelectedFiles(files)
      setSelectedDevice({
        id: `direct-${ip}`,
        name: `直连设备`,
        ip: ip,
        port: 12138,
        avatarIndex: 0
      })
    }
  }

  const handleAddMoreFiles = async () => {
    const files = await window.electronAPI.selectFiles()
    if (files && files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files])
    }
  }

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, idx) => idx !== index))
  }

  const handleSendFiles = async () => {
    if (!selectedDevice || selectedFiles.length === 0) return

    const transferId = Math.random().toString(36).substring(2, 9)

    // Trigger Dynamic Island starting state
    setTransferState({
      id: transferId,
      direction: 'outgoing',
      progress: 0,
      speed: 0,
      bytesTransferred: 0,
      totalSize: selectedFiles.reduce((acc, f) => acc + f.size, 0),
      status: 'sending',
      peerName: selectedDevice.name
    })

    lastTimeRef.current = Date.now()
    lastBytesRef.current = 0

    const result = await window.electronAPI.sendFiles(selectedDevice.ip, selectedFiles, transferId)
    
    if (!result.success && !cancelledIdsRef.current.has(transferId)) {
      const failStatus = result.error === 'Rejected by receiver' ? 'declined' : 'failed'
      handleTransferComplete({
        id: transferId,
        direction: 'outgoing',
        totalSize: selectedFiles.reduce((acc, f) => acc + f.size, 0)
      }, failStatus)
    }
    cancelledIdsRef.current.delete(transferId)
  }

  const handleAcceptIncoming = async (accept: boolean) => {
    if (!incomingTransfer) return
    
    if (accept) {
      setTransferState({
        id: incomingTransfer.id,
        direction: 'incoming',
        progress: 0,
        speed: 0,
        bytesTransferred: 0,
        totalSize: incomingTransfer.totalSize,
        status: 'receiving',
        peerName: incomingTransfer.senderName
      })
      lastTimeRef.current = Date.now()
      lastBytesRef.current = 0
    }
    
    await window.electronAPI.acceptTransfer(incomingTransfer.id, accept)
    
    if (!accept) {
      setIncomingTransfer(null)
    }
  }

  const handleSaveNickname = async () => {
    if (tempNickname.trim()) {
      const saved = await window.electronAPI.setMyNickname(tempNickname)
      setMyNickname(saved)
    }
  }
  const hasActiveTransfer = !!(transferState && (transferState.status === 'sending' || transferState.status === 'receiving' || transferState.status === 'paused'))

  return (
    <div className={`relative w-screen h-screen overflow-hidden flex justify-center items-center bg-transparent p-2 font-sans select-none ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
      {/* Main Container */}
      <div className="w-full h-full rounded-3xl overflow-hidden border border-white/10 flex liquid-glass-panel relative flex-col shadow-2xl">
        {/* Dynamic blurred iOS mesh background blobs — wrapped in clip-path container to prevent blur bleeding outside rounded corners */}
        <div className="absolute inset-0 overflow-hidden rounded-[inherit] pointer-events-none" style={{ clipPath: 'inset(0 round 1.5rem)' }}>
          <div className="absolute top-[-10%] left-[-10%] w-[55%] h-[55%] bg-blue-600/20 rounded-full blur-[120px]"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] bg-purple-600/25 rounded-full blur-[120px]"></div>
          <div className="absolute top-[30%] right-[10%] w-[35%] h-[35%] bg-indigo-500/15 rounded-full blur-[100px]"></div>
        </div>
        
        {/* Windows style top header/titlebar */}
        <div className="titlebar-drag h-12 w-full flex items-center justify-between pl-6 pr-2 border-b border-white/5 relative z-30 select-none">
          <div className="text-[11px] text-white/40 font-semibold tracking-widest uppercase">LAN Transfer</div>
          
          {/* Windows-style Window Controls on the right */}
          <div className="titlebar-no-drag flex items-center h-full">
            <button 
              onClick={() => window.electronAPI.minimizeWindow()}
              className="w-12 h-12 flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors duration-150"
              title="最小化"
            >
              <span className="w-3.5 h-[1.5px] bg-white"></span>
            </button>
            <button 
              onClick={() => window.electronAPI.maximizeWindow()}
              className="w-12 h-12 flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors duration-150"
              title="最大化"
            >
              <span className="w-3 h-3 border border-white bg-transparent"></span>
            </button>
            <button 
              onClick={() => window.electronAPI.closeWindow()}
              className="w-12 h-12 flex items-center justify-center text-white/70 hover:bg-red-600 hover:text-white transition-colors duration-150"
              title="关闭"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 10 10">
                <path d="M 0,0 L 10,10 M 10,0 L 0,10" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            </button>
          </div>
        </div>

        {/* Dynamic Island Status Pill */}
        <DynamicIsland 
          transferState={transferState} 
          onPause={handlePause}
          onResume={handleResume}
          onCancel={handleCancel}
        />

        {/* App Main Area */}
        <div className="flex-1 flex overflow-hidden relative">
          <Sidebar 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            myNickname={myNickname}
            myAvatarIndex={myAvatarIndex}
            myIp={myIp}
            hasActiveTransfer={hasActiveTransfer}
          />

          {/* Tab Pages */}
          <div className="flex-1 h-full bg-black/10 overflow-y-auto relative">
            
            {/* 1. SEND VIEW */}
            {activeTab === 'send' && (
              <Radar devices={devices} onSelectDevice={handleSelectDevice} onDirectConnect={handleDirectConnect} />
            )}

            {/* 2. HISTORY VIEW */}
            {activeTab === 'history' && (
              <div className="p-8 text-white max-w-3xl mx-auto h-full flex flex-col">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  <ArrowRightLeft className="w-5 h-5 text-blue-400" />
                  <span>文件传输记录</span>
                </h2>
                
                {history.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-white/30">
                    <HistoryIcon className="w-12 h-12 stroke-[1.5] mb-2" />
                    <p className="text-sm">暂无传输历史</p>
                  </div>
                ) : (
                  <div className="space-y-3 overflow-y-auto pr-2 flex-1">
                    {history.map((record) => (
                      <div 
                        key={record.id}
                        className="bg-white/5 border border-white/5 p-4 rounded-2xl flex items-center justify-between gap-4 hover:bg-white/10 transition-all duration-300"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
                            record.direction === 'outgoing' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' : 'bg-green-500/10 border-green-500/20 text-green-400'
                          }`}>
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-xs font-semibold truncate max-w-[200px]" title={record.fileName}>
                              {record.fileName}
                            </p>
                            <p className="text-[10px] text-white/40 mt-0.5">
                              {record.direction === 'outgoing' ? '发送给' : '接收自'} <span className="font-bold text-white/60">{record.peerName}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-right flex-shrink-0">
                          <div>
                            <p className="text-xs font-semibold">{formatSize(record.totalSize)}</p>
                            <p className="text-[9px] text-white/30 mt-0.5 font-mono">{record.time}</p>
                          </div>
                          
                          {record.status === 'completed' ? (
                            <span className="flex items-center gap-1 text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full border border-green-500/30 font-semibold">
                              <CheckCircle className="w-3 h-3" />
                              成功
                            </span>
                          ) : record.status === 'cancelled' ? (
                            <span className="flex items-center gap-1 text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-500/30 font-semibold">
                              <XCircle className="w-3 h-3 text-yellow-400" />
                              中止
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30 font-semibold">
                              <XCircle className="w-3 h-3" />
                              {record.status === 'declined' ? '被拒绝' : '失败'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. TRANSFERRING VIEW */}
            {activeTab === 'transferring' && (
              <div className="p-8 text-white max-w-2xl mx-auto h-full flex flex-col justify-center items-center">
                {hasActiveTransfer ? (
                  <div className="w-full liquid-glass-card p-8 rounded-3xl border border-white/10 flex flex-col gap-6 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl pointer-events-none"></div>
                    
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 shadow-md">
                          <ShibaAvatar index={transferState.direction === 'outgoing' ? 0 : 3} size={42} />
                        </div>
                        <div>
                          <h3 className="font-bold text-base text-white">
                            {transferState.direction === 'outgoing' ? `正在发送文件至 ${transferState.peerName}` : `正在接收来自 ${transferState.peerName} 的文件`}
                          </h3>
                          <p className="text-xs text-white/50 mt-1 flex items-center gap-2">
                            <span>传输大小: {formatSize(transferState.totalSize)}</span>
                            <span>•</span>
                            <span>已传输: {formatSize(transferState.bytesTransferred)}</span>
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs font-bold text-white/80 uppercase">
                          {transferState.status === 'paused' ? (
                            <span className="text-yellow-400">已暂停</span>
                          ) : transferState.direction === 'outgoing' ? (
                            <span className="text-blue-400">发送中</span>
                          ) : (
                            <span className="text-green-400">接收中</span>
                          )}
                        </div>
                        <div className="text-xl font-black font-mono mt-1 text-blue-400">
                          {Math.round(transferState.progress * 100)}%
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2 mt-2">
                      <div className="w-full bg-white/10 h-3 rounded-full overflow-hidden border border-white/5 p-[1px]">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            transferState.status === 'paused'
                              ? 'bg-yellow-500'
                              : transferState.direction === 'outgoing'
                              ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
                              : 'bg-gradient-to-r from-green-500 to-emerald-500'
                          }`}
                          style={{ width: `${transferState.progress * 100}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-xs text-white/40 font-mono">
                        <span>速度: {transferState.status === 'paused' ? '0 B/s' : formatSpeed(transferState.speed)}</span>
                        <span>
                          {transferState.status === 'paused'
                            ? '已暂停'
                            : transferState.speed > 0
                            ? `剩余: ${formatRemainingTime(Math.ceil((transferState.totalSize - transferState.bytesTransferred) / transferState.speed))}`
                            : '计算中...'}
                        </span>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="flex gap-4 mt-4 justify-end">
                      {transferState.status === 'paused' ? (
                        <button
                          onClick={handleResume}
                          className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-95 text-xs font-bold tracking-wider text-white shadow-lg transition-all duration-200 border border-white/10 flex items-center gap-2"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>继续传输</span>
                        </button>
                      ) : (
                        <button
                          onClick={handlePause}
                          className="px-6 py-2.5 rounded-xl bg-yellow-600 hover:bg-yellow-500 active:scale-95 text-xs font-bold tracking-wider text-white shadow-lg transition-all duration-200 border border-white/10 flex items-center gap-2"
                        >
                          <Pause className="w-3.5 h-3.5 fill-current" />
                          <span>暂停传输</span>
                        </button>
                      )}
                      
                      <button
                        onClick={handleCancel}
                        className="px-6 py-2.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 hover:border-red-500/50 active:scale-95 text-xs font-bold tracking-wider text-red-300 transition-all duration-200 flex items-center gap-2"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>中止传输</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-white/30 p-8 border border-dashed border-white/10 rounded-3xl w-full py-16 bg-white/5">
                    <ArrowRightLeft className="w-12 h-12 stroke-[1.5] mb-4 text-white/20 animate-pulse" />
                    <p className="text-sm font-semibold text-white/50">当前没有进行中的传输任务</p>
                    <p className="text-xs text-white/30 mt-1">在主页选择局域网设备并发送文件即可在此查看详情</p>
                  </div>
                )}
              </div>
            )}

            {/* 3. SETTINGS VIEW */}
            {activeTab === 'settings' && (
              <div className="p-8 text-white max-w-xl mx-auto">
                <h2 className="text-xl font-bold mb-8">系统参数设置</h2>

                <div className="space-y-6">
                  {/* Nickname modification */}
                  <div className="space-y-2">
                    <label className="text-xs text-white/50 font-semibold tracking-wider uppercase block">用户昵称</label>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={tempNickname}
                        onChange={(e) => setTempNickname(e.target.value)}
                        placeholder="请输入局域网昵称"
                        maxLength={20}
                        className="flex-1 bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-all duration-300 placeholder-white/30"
                      />
                      <button
                        onClick={handleSaveNickname}
                        disabled={!tempNickname.trim() || tempNickname === myNickname}
                        className="px-6 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 border border-white/10 hover:from-blue-600 hover:to-indigo-700 active:scale-95 text-xs font-semibold text-white shadow-lg transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        更新
                      </button>
                    </div>
                  </div>

                  {/* Avatar choosing */}
                  <div className="space-y-3">
                    <label className="text-xs text-white/50 font-semibold tracking-wider uppercase block">选择柴犬头像配饰</label>
                    <div className="grid grid-cols-6 gap-3">
                      {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <button
                          key={idx}
                          onClick={() => {
                            setMyAvatarIndex(idx)
                            window.electronAPI.setMyAvatarIndex(idx)
                          }}
                          className={`w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center border relative transition-all duration-300 hover:scale-105 active:scale-95 ${
                            myAvatarIndex === idx ? 'border-white ring-2 ring-blue-500 scale-105' : 'border-white/10'
                          }`}
                        >
                          <ShibaAvatar index={idx} size={42} />
                          {myAvatarIndex === idx && (
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center border border-white/50">
                              <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Theme settings */}
                  <div className="space-y-3">
                    <label className="text-xs text-white/50 font-semibold tracking-wider uppercase block">界面主题</label>
                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          setTheme('dark')
                          localStorage.setItem('theme', 'dark')
                        }}
                        className={`flex-1 py-3 rounded-2xl border text-center transition-all duration-300 font-semibold text-xs ${
                          theme === 'dark'
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                            : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/70'
                        }`}
                      >
                        黑夜
                      </button>
                      <button
                        onClick={() => {
                          setTheme('light')
                          localStorage.setItem('theme', 'light')
                        }}
                        className={`flex-1 py-3 rounded-2xl border text-center transition-all duration-300 font-semibold text-xs ${
                          theme === 'light'
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20'
                            : 'bg-white/5 hover:bg-white/10 border-white/10 text-white/70'
                        }`}
                      >
                        白天
                      </button>
                    </div>
                  </div>

                  {/* System details */}
                  <div className="pt-6 border-t border-white/10 space-y-4">
                    <div className="flex justify-between items-center bg-white/5 border border-white/5 p-4 rounded-xl">
                      <div>
                        <span className="text-[11px] text-white/40 uppercase block">本机局域网 IP</span>
                        <span className="text-sm font-semibold font-mono mt-0.5 block">{myIp}</span>
                      </div>
                      <Laptop className="w-5 h-5 text-white/30" />
                    </div>

                    <div className="flex justify-between items-center bg-white/5 border border-white/5 p-4 rounded-xl">
                      <div className="flex-1 mr-4 overflow-hidden">
                        <span className="text-[11px] text-white/40 uppercase block">默认接收文件夹</span>
                        <span className="text-xs font-semibold text-white/80 mt-0.5 block truncate" title={saveDir}>{saveDir}</span>
                      </div>
                      <button
                        onClick={async () => {
                          const dir = await window.electronAPI.selectDirectory()
                          if (dir) {
                            const saved = await window.electronAPI.setSaveDir(dir)
                            setSaveDir(saved)
                          }
                        }}
                        className="bg-white/10 hover:bg-white/15 active:scale-95 text-xs text-white border border-white/15 px-4 py-2 rounded-lg transition-all shrink-0"
                      >
                        更改
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Overlays / Modal Windows */}
            
            {/* 1. File List Preview Overlay */}
            {selectedDevice && selectedFiles.length > 0 && (
              <FileList
                files={selectedFiles}
                targetDevice={selectedDevice}
                onRemoveFile={handleRemoveFile}
                onAddMoreFiles={handleAddMoreFiles}
                onCancel={() => {
                  setSelectedDevice(null)
                  setSelectedFiles([])
                }}
                onSend={handleSendFiles}
              />
            )}

            {/* 2. Incoming transfer request modal */}
            {incomingTransfer && !transferState && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-6 z-40 animate-fade-in">
                <div className="w-full max-w-sm liquid-glass-panel rounded-3xl p-6 border border-white/20 shadow-2xl flex flex-col">
                  
                  <div className="flex flex-col items-center text-center pb-4 mb-4 border-b border-white/10">
                    <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center border border-white/20 shadow mb-3">
                      <ShibaAvatar index={0} size={54} />
                    </div>
                    <h3 className="font-bold text-lg text-white">文件接收请求</h3>
                    <p className="text-xs text-white/50 mt-1">
                      来自 <span className="font-semibold text-white">{incomingTransfer.senderName}</span>
                    </p>
                  </div>

                  <div className="bg-white/5 border border-white/5 p-4 rounded-2xl mb-6 text-xs text-center">
                    <p className="text-white/60">准备发送给您：</p>
                    <p className="font-bold text-sm text-white/95 mt-1.5 truncate max-w-xs" title={incomingTransfer.files[0]?.name}>
                      {incomingTransfer.files[0]?.name} {incomingTransfer.files.length > 1 ? `等 ${incomingTransfer.files.length} 个文件` : ''}
                    </p>
                    <p className="text-[10px] text-blue-400 font-mono mt-1">总大小: {formatSize(incomingTransfer.totalSize)}</p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => handleAcceptIncoming(false)}
                      className="flex-1 py-3 rounded-2xl bg-red-500/20 hover:bg-red-500/30 active:scale-95 text-red-400 font-semibold border border-red-500/25 text-sm transition-all duration-300"
                    >
                      拒绝
                    </button>
                    <button
                      onClick={() => handleAcceptIncoming(true)}
                      className="flex-1 py-3 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 active:scale-95 text-white font-semibold border border-white/10 shadow-lg shadow-blue-500/25 text-sm transition-all duration-300"
                    >
                      同意接收
                    </button>
                  </div>

                </div>
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  )
}
