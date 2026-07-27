import { useEffect, useState, useRef } from 'react'
import QRCode from 'qrcode'
import { QrCode, X, Copy, Check, Smartphone, Power, FileUp, Sparkles } from 'lucide-react'

interface WebShareModalProps {
  isOpen: boolean
  onClose: () => void
}

export function WebShareModal({ isOpen, onClose }: WebShareModalProps) {
  const [serverStatus, setServerStatus] = useState<{ isRunning: boolean; port: number; url: string }>({
    isRunning: false,
    port: 12139,
    url: ''
  })
  const [copied, setCopied] = useState(false)
  const [sharingSuccess, setSharingSuccess] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (isOpen && window.electronAPI) {
      window.electronAPI.getWebServerStatus().then(status => {
        setServerStatus(status)
      })
    }
  }, [isOpen])

  useEffect(() => {
    if (serverStatus.isRunning && serverStatus.url && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, serverStatus.url, {
        width: 180,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      }).catch(err => console.error('QR code generation error:', err))
    }
  }, [serverStatus])

  if (!isOpen) return null

  const handleToggle = async () => {
    if (!window.electronAPI) return
    const res = await window.electronAPI.toggleWebServer(!serverStatus.isRunning)
    setServerStatus(res)
  }

  const handleCopy = () => {
    if (!serverStatus.url) return
    navigator.clipboard.writeText(serverStatus.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleShareFile = async () => {
    if (!window.electronAPI) return
    const files = await window.electronAPI.selectFiles()
    if (files && files.length > 0) {
      for (const file of files) {
        await window.electronAPI.shareFileToWeb(file.path)
      }
      setSharingSuccess(true)
      setTimeout(() => setSharingSuccess(false), 3000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-xl">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold">手机扫码免 APP 互传</h3>
            <p className="text-xs text-slate-400">同一 WiFi 极速连接手机与电脑</p>
          </div>
        </div>

        {/* Server Status Switch */}
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Power className={`w-5 h-5 ${serverStatus.isRunning ? 'text-emerald-400' : 'text-slate-500'}`} />
            <div>
              <div className="text-sm font-medium">网页共享服务</div>
              <div className="text-xs text-slate-400">
                {serverStatus.isRunning ? '服务运行中 (可免安装访问)' : '服务已关闭'}
              </div>
            </div>
          </div>
          <button
            onClick={handleToggle}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              serverStatus.isRunning
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {serverStatus.isRunning ? '运行中' : '开启服务'}
          </button>
        </div>

        {serverStatus.isRunning ? (
          <div className="flex flex-col items-center">
            {/* QR Code Container */}
            <div className="bg-white p-3 rounded-2xl shadow-lg border border-slate-200 mb-4">
              <canvas ref={canvasRef} className="rounded-lg" />
            </div>

            <p className="text-xs text-slate-400 mb-3 text-center">
              使用手机自带相机或微信扫一扫直接访问
            </p>

            {/* URL Display & Copy */}
            <div className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between mb-5">
              <span className="text-xs font-mono text-sky-400 truncate mr-2 select-all">
                {serverStatus.url}
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-2.5 py-1.5 rounded-lg transition shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>

            {/* Share File Action */}
            <button
              onClick={handleShareFile}
              className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-xl text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-sky-500/20"
            >
              <FileUp className="w-4 h-4" />
              推送文件到手机网页下载区
            </button>

            {sharingSuccess && (
              <div className="mt-2 text-xs text-emerald-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                已添加到手机网页下载区！
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500 text-sm">
            <QrCode className="w-12 h-12 mx-auto mb-2 opacity-30" />
            点击上方按钮开启共享服务以生成二维码
          </div>
        )}
      </div>
    </div>
  )
}
