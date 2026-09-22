import React from 'react'
import { File, Trash2, Send, X, Plus } from 'lucide-react'

interface SelectedFile {
  path: string
  name: string
  size: number
}

interface Device {
  id: string
  name: string
  ip: string
  avatarIndex: number
}

interface FileListProps {
  files: SelectedFile[]
  targetDevice: Device
  onRemoveFile: (index: number) => void
  onAddMoreFiles: () => void
  onCancel: () => void
  onSend: () => void
  theme?: 'dark' | 'light'
}

// Utility to format file size
const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export const FileList: React.FC<FileListProps> = ({
  files,
  targetDevice,
  onRemoveFile,
  onAddMoreFiles,
  onCancel,
  onSend,
  theme = 'dark'
}) => {
  const totalSize = files.reduce((acc, f) => acc + f.size, 0)
  const isLight = theme === 'light'

  return (
    <div className={`absolute inset-0 flex items-center justify-center p-6 z-20 select-none animate-fade-in transition-colors duration-200 ${
      isLight ? 'bg-slate-900/30' : 'bg-black/60'
    } backdrop-blur-md`}>
      <div className={`w-full max-w-lg rounded-3xl p-6 flex flex-col max-h-[85vh] border shadow-2xl transition-colors duration-200 ${
        isLight ? 'bg-white border-slate-200 text-slate-800' : 'liquid-glass-panel border-white/20 text-white'
      }`}>
        
        {/* Header */}
        <div className={`flex items-center justify-between border-b pb-4 mb-4 ${
          isLight ? 'border-slate-200' : 'border-white/10'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl bg-gradient-avatar-${targetDevice.avatarIndex} flex items-center justify-center border border-white/20 shadow`}>
              <span className="font-bold text-sm text-white">{targetDevice.name[0]?.toUpperCase()}</span>
            </div>
            <div>
              <h2 className={`font-bold text-base leading-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                发送给 {targetDevice.name}
              </h2>
              <p className={`text-[10px] font-mono mt-0.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                {targetDevice.ip}
              </p>
            </div>
          </div>
          <button 
            onClick={onCancel}
            title="关闭"
            className={`p-2 rounded-xl transition-colors ${
              isLight ? 'hover:bg-slate-100 text-slate-400 hover:text-slate-700' : 'hover:bg-white/10 text-white/70 hover:text-white'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* File List Area */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-2 mb-4">
          {files.map((file, idx) => (
            <div 
              key={idx} 
              className={`border p-3 rounded-2xl flex items-center justify-between gap-3 transition-colors group ${
                isLight ? 'bg-slate-50 hover:bg-slate-100/80 border-slate-200' : 'bg-white/5 hover:bg-white/10 border-white/5'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden min-w-0">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center border flex-shrink-0 ${
                  isLight ? 'bg-blue-50 border-blue-100 text-blue-600' : 'bg-white/10 border-white/10 text-blue-300'
                }`}>
                  <File className="w-5 h-5" />
                </div>
                <div className="overflow-hidden">
                  <p className={`text-xs font-semibold truncate pr-2 ${isLight ? 'text-slate-900' : 'text-white'}`} title={file.name}>
                    {file.name}
                  </p>
                  <p className={`text-[10px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-white/40'}`}>{formatSize(file.size)}</p>
                </div>
              </div>
              
              <button
                onClick={() => onRemoveFile(idx)}
                title="移除文件"
                className={`p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-300 flex-shrink-0 ${
                  isLight ? 'text-slate-400 hover:text-red-600 hover:bg-red-50' : 'text-white/30 hover:text-red-400 hover:bg-white/5'
                }`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Summary Info */}
        <div className={`border rounded-2xl p-4 mb-5 flex justify-between items-center text-xs ${
          isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/5 border-white/10'
        }`}>
          <div>
            <span className={`block ${isLight ? 'text-slate-500' : 'text-white/50'}`}>待发送文件</span>
            <span className={`font-bold text-sm ${isLight ? 'text-slate-900' : 'text-white/90'}`}>{files.length} 个文件</span>
          </div>
          <div className="text-right">
            <span className={`block ${isLight ? 'text-slate-500' : 'text-white/50'}`}>总大小</span>
            <span className="font-bold text-sm text-blue-500">{formatSize(totalSize)}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onAddMoreFiles}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border text-sm font-semibold transition-all duration-300 shadow-sm ${
              isLight ? 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700' : 'border-white/20 bg-white/5 hover:bg-white/10 active:bg-white/15 text-white'
            }`}
          >
            <Plus className="w-4 h-4" />
            继续添加
          </button>
          
          <button
            onClick={onSend}
            disabled={files.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 active:scale-95 text-white text-sm font-semibold border border-white/10 shadow-lg shadow-blue-500/25 transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none"
          >
            <Send className="w-4 h-4" />
            开始发送
          </button>
        </div>

      </div>
    </div>
  )
}
