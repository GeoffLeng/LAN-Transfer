import React from 'react'
import { Send, History, Settings, ArrowRightLeft } from 'lucide-react'
import { ShibaAvatar } from './ShibaAvatar'
import logoImg from '../../logo.png'

interface SidebarProps {
  activeTab: string
  setActiveTab: (tab: 'send' | 'history' | 'settings' | 'transferring') => void
  myNickname: string
  myAvatarIndex: number
  myIp: string
  hasActiveTransfer?: boolean
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  myNickname,
  myAvatarIndex,
  myIp,
  hasActiveTransfer
}) => {
  return (
    <div className="w-64 liquid-glass-sidebar flex flex-col justify-between h-full p-6 text-white select-none border-r border-white/10">
      {/* App Logo */}
      <div>
        <div className="flex items-center gap-3 mb-10 mt-4">
          <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-lg shadow-blue-500/30 border border-white/20">
            <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight tracking-wide">Transfer</h1>
            <p className="text-[10px] text-white/50 tracking-wider">Windows Client</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1.5">
          <button
            onClick={() => setActiveTab('send')}
            className={`w-full flex items-center gap-4 px-4 py-3 transition-all duration-200 font-medium text-sm border-l-4 border-y border-r ${
              activeTab === 'send'
                ? 'bg-white/10 border-l-blue-500 border-y-transparent border-r-transparent text-white'
                : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
            } rounded-r-md`}
          >
            <Send className="w-4 h-4" />
            <span>发送文件</span>
          </button>
          
          <button
            onClick={() => setActiveTab('transferring')}
            className={`w-full flex items-center justify-between px-4 py-3 transition-all duration-200 font-medium text-sm border-l-4 border-y border-r ${
              activeTab === 'transferring'
                ? 'bg-white/10 border-l-blue-500 border-y-transparent border-r-transparent text-white'
                : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
            } rounded-r-md`}
          >
            <div className="flex items-center gap-4">
              <ArrowRightLeft className="w-4 h-4" />
              <span>正在传输</span>
            </div>
            {hasActiveTransfer && (
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse mr-1"></span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`w-full flex items-center gap-4 px-4 py-3 transition-all duration-200 font-medium text-sm border-l-4 border-y border-r ${
              activeTab === 'history'
                ? 'bg-white/10 border-l-blue-500 border-y-transparent border-r-transparent text-white'
                : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
            } rounded-r-md`}
          >
            <History className="w-4 h-4" />
            <span>传输历史</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-4 px-4 py-3 transition-all duration-200 font-medium text-sm border-l-4 border-y border-r ${
              activeTab === 'settings'
                ? 'bg-white/10 border-l-blue-500 border-y-transparent border-r-transparent text-white'
                : 'border-transparent text-white/70 hover:bg-white/5 hover:text-white'
            } rounded-r-md`}
          >
            <Settings className="w-4 h-4" />
            <span>系统设置</span>
          </button>
        </nav>
      </div>

      {/* User Status Card */}
      <div className="bg-white/10 border border-white/10 p-4 rounded-xl flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shadow-md">
          <ShibaAvatar index={myAvatarIndex} size={36} />
        </div>
        <div className="overflow-hidden">
          <p className="font-semibold text-sm truncate">{myNickname}</p>
          <p className="text-[10px] text-white/40 font-mono truncate">{myIp}</p>
        </div>
      </div>
    </div>
  )
}
