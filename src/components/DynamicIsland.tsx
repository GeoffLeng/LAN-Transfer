import React, { useEffect, useState, useRef } from 'react'
import { ArrowUp, ArrowDown, Check, AlertCircle, Play, Pause, XCircle, X } from 'lucide-react'

interface TransferState {
  id: string
  direction: 'incoming' | 'outgoing'
  progress: number
  speed: number
  bytesTransferred: number
  totalSize: number
  status: 'idle' | 'sending' | 'receiving' | 'completed' | 'failed' | 'declined' | 'paused'
  peerName?: string
}

interface DynamicIslandProps {
  transferState: TransferState | null
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
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

export const DynamicIsland: React.FC<DynamicIslandProps> = ({
  transferState,
  onPause,
  onResume,
  onCancel
}) => {
  const [visible, setVisible] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [dimensions, setDimensions] = useState('w-44 h-8 rounded-full')
  const lastTransferIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!transferState || transferState.status === 'idle') {
      setVisible(false)
      setIsDismissed(false)
      setDimensions('w-44 h-8 rounded-full')
      lastTransferIdRef.current = null
      return
    }

    if (transferState.id !== lastTransferIdRef.current) {
      lastTransferIdRef.current = transferState.id
      setIsDismissed(false)
    }

    setVisible(true)

    if (
      transferState.status === 'sending' ||
      transferState.status === 'receiving' ||
      transferState.status === 'paused'
    ) {
      setDimensions('w-[420px] h-[108px] rounded-2xl')
    } else if (transferState.status === 'completed') {
      setDimensions('w-[240px] h-[40px] rounded-full')
    } else if (transferState.status === 'failed' || transferState.status === 'declined') {
      setDimensions('w-[240px] h-[40px] rounded-full')
    }
  }, [transferState])

  if (!visible || !transferState || isDismissed) return null

  const isSending = transferState.direction === 'outgoing'
  const percentage = Math.round(transferState.progress * 100)
  const isTransferring =
    transferState.status === 'sending' ||
    transferState.status === 'receiving' ||
    transferState.status === 'paused'

  const handleCardClick = () => {
    if (transferState.status === 'paused') {
      onResume?.()
    } else if (transferState.status === 'sending' || transferState.status === 'receiving') {
      onPause?.()
    }
  }

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 pointer-events-none select-none">
      <div
        onClick={handleCardClick}
        className={`dynamic-island-pill bg-black/95 text-white flex items-center justify-between px-5 py-2.5 shadow-2xl transition-all duration-500 ease-out border border-white/10 overflow-hidden pointer-events-auto cursor-pointer hover:bg-black/90 active:scale-[0.99] ${dimensions}`}
      >
        {/* Progressing/Paused state */}
        {isTransferring && (
          <div className="w-full flex flex-col justify-between h-full py-0.5">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  transferState.status === 'paused' 
                    ? 'bg-yellow-500/20 text-yellow-400' 
                    : isSending 
                      ? 'bg-blue-500/20 text-blue-400' 
                      : 'bg-green-500/20 text-green-400'
                }`}>
                  {transferState.status === 'paused' ? (
                    <Pause className="w-3 h-3" />
                  ) : isSending ? (
                    <ArrowUp className="w-3 h-3 animate-bounce" />
                  ) : (
                    <ArrowDown className="w-3 h-3 animate-bounce" />
                  )}
                </div>
                <span className="text-[11px] font-semibold tracking-wide flex items-center gap-1.5">
                  {isSending ? `发送至 ${transferState.peerName || '设备'}` : `来自 ${transferState.peerName || '设备'}`}
                  {transferState.status === 'paused' && <span className="text-yellow-400 text-[10px] bg-yellow-500/10 px-1.5 py-0.2 rounded border border-yellow-500/20 font-medium">已暂停</span>}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white/50 font-mono">
                  {transferState.status === 'paused' ? '已暂停' : formatSpeed(transferState.speed)}
                </span>
                <span className={`text-xs font-bold font-mono ${transferState.status === 'paused' ? 'text-yellow-400' : 'text-blue-400'}`}>{percentage}%</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsDismissed(true)
                  }}
                  className="p-1 -mr-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors pointer-events-auto"
                  title="收起浮窗 (后台继续传输)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden my-1">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  transferState.status === 'paused'
                    ? 'bg-yellow-500'
                    : isSending
                    ? 'bg-blue-500'
                    : 'bg-green-500'
                }`}
                style={{ width: `${percentage}%` }}
              ></div>
            </div>

            <div className="flex justify-between items-center w-full text-[9px] text-white/40 font-mono">
              <span>
                {formatSize(transferState.bytesTransferred)} / {formatSize(transferState.totalSize)}
              </span>
              <div className="flex items-center gap-3 pointer-events-auto">
                {/* Control Buttons inside Card */}
                {transferState.status === 'paused' ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onResume?.()
                    }}
                    className="p-1 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                    title="继续传输"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onPause?.()
                    }}
                    className="p-1 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
                    title="暂停传输"
                  >
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCancel?.()
                  }}
                  className="px-1.5 py-0.5 rounded hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
                  title="中止传输"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-semibold text-red-400">中止</span>
                </button>
                <span className="text-[9px] text-white/40 ml-1">
                  {transferState.status === 'paused'
                    ? '已暂停'
                    : transferState.speed > 0
                    ? `剩余时间: ${Math.ceil((transferState.totalSize - transferState.bytesTransferred) / transferState.speed)}秒`
                    : '计算中...'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Completed state */}
        {transferState.status === 'completed' && (
          <div className="w-full flex items-center justify-center gap-2.5">
            <div className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center">
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
            <span className="text-xs font-bold text-green-300">传输已成功完成</span>
          </div>
        )}

        {/* Failed state */}
        {(transferState.status === 'failed' || transferState.status === 'declined') && (
          <div className="w-full flex items-center justify-center gap-2.5">
            <div className="w-5 h-5 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
              <AlertCircle className="w-3 h-3" />
            </div>
            <span className="text-xs font-bold text-red-300">
              {transferState.status === 'declined' ? '接收端拒绝了传输' : '传输中断，请重试'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
