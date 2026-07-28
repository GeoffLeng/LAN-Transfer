import React, { useState } from 'react'
import { Laptop, Search, Smartphone } from 'lucide-react'
import { ShibaAvatar } from './ShibaAvatar'

interface Device {
  id: string
  name: string
  ip: string
  port: number
  avatarIndex: number
  isMobile?: boolean
}

interface RadarProps {
  devices: Device[]
  onSelectDevice: (device: Device) => void
  onDirectConnect?: (ip: string) => void
  onSpeedTest: (ip: string) => void
}

export const Radar: React.FC<RadarProps> = ({ devices, onSelectDevice, onDirectConnect, onSpeedTest }) => {
  const [directIp, setDirectIp] = useState('')

  const handleDirectConnect = (e: React.FormEvent) => {
    e.preventDefault()
    if (directIp.trim() && onDirectConnect) {
      onDirectConnect(directIp.trim())
    }
  }

  return (
    <div className="relative flex-1 h-full flex flex-col items-center justify-center p-6 text-white overflow-hidden pb-24">
      {/* Search Header Info */}
      <div className="absolute top-8 left-10 flex items-center gap-2 bg-white/5 border border-white/10 px-4 py-2 rounded-full backdrop-blur-md">
        <Search className="w-4 h-4 text-white/60 animate-pulse" />
        <span className="text-xs text-white/80 font-medium">正在扫描局域网设备...</span>
      </div>

      {/* Radar Animation Rings */}
      <div className="absolute w-[500px] h-[500px] flex items-center justify-center pointer-events-none select-none">
        <div className="absolute w-full h-full rounded-full border border-white/5 radar-pulse-wave"></div>
        <div className="absolute w-[360px] h-[360px] rounded-full border border-white/10 radar-pulse-wave" style={{ animationDelay: '1s' }}></div>
        <div className="absolute w-[220px] h-[220px] rounded-full border border-white/15 radar-pulse-wave" style={{ animationDelay: '2s' }}></div>
        
        {/* Core Pulsing Center */}
        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center border border-white/30 shadow-2xl shadow-blue-500/50">
          <Laptop className="w-6 h-6 text-white" />
        </div>
      </div>

      {/* Peer Cards Overlay Area */}
      <div className="relative z-10 w-full max-w-2xl grid grid-cols-2 sm:grid-cols-3 gap-6 justify-center items-center mt-20">
        {devices.map((device) => {
          return (
            <div
              key={device.id}
              className="liquid-glass-card p-5 rounded-xl flex flex-col items-center justify-center text-center cursor-default select-none border border-white/10 w-full relative"
            >
              {/* Avatar Container with glowing hover */}
              <div className="relative w-16 h-16 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shadow-md mb-4 group-hover:scale-105 transition-transform duration-300">
                {device.isMobile ? (
                  <div className="w-full h-full flex items-center justify-center text-sky-400">
                    <Smartphone className="w-8 h-8" />
                  </div>
                ) : (
                  <ShibaAvatar index={device.avatarIndex} size={54} />
                )}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-[#121214] rounded-full"></div>
              </div>
              
              {/* Device Text */}
              <div className="flex items-center gap-1 max-w-full">
                {device.isMobile && <span className="text-xs">📱</span>}
                <h3 className="font-semibold text-sm text-white truncate max-w-full">
                  {device.name}
                </h3>
              </div>
              <p className="text-[10px] text-sky-400 font-mono mt-1 font-semibold">{device.ip}</p>
              
              {/* Controls */}
              <div className="flex items-center gap-2 mt-4 w-full z-20">
                <button
                  onClick={() => onSelectDevice(device)}
                  className="flex-1 bg-blue-600/30 hover:bg-blue-500/50 text-blue-200 border border-blue-500/40 text-[10px] py-1 rounded-lg transition-colors font-medium cursor-pointer"
                >
                  发送文件
                </button>
                <button
                  onClick={() => onSpeedTest(device.ip)}
                  className="flex-1 bg-emerald-600/30 hover:bg-emerald-500/50 text-emerald-200 border border-emerald-500/40 text-[10px] py-1 rounded-lg transition-colors font-medium cursor-pointer"
                >
                  🚀 测速
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty State */}
      {devices.length === 0 && (
        <div className="text-center text-white/40 max-w-xs mt-20 select-none pointer-events-none">
          <p className="text-sm font-medium">无其他在线设备</p>
          <p className="text-xs mt-1">在其他电脑上打开本应用即可自动连入</p>
        </div>
      )}

      {/* Direct IP Fallback Connection Box */}
      <form 
        onSubmit={handleDirectConnect}
        className="absolute bottom-6 left-6 right-6 flex items-center gap-3 bg-white/5 border border-white/10 p-2.5 rounded-xl backdrop-blur-md max-w-md mx-auto z-20"
      >
        <div className="flex-1">
          <input
            type="text"
            placeholder="输入局域网 IP 直连 (例: 192.168.0.6)"
            value={directIp}
            onChange={(e) => setDirectIp(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-blue-500/50"
          />
        </div>
        <button
          type="submit"
          disabled={!directIp.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-white/30 text-white font-medium text-xs px-4 py-1.5 rounded-lg transition-colors duration-200 border border-white/10 shrink-0"
        >
          直接连接
        </button>
      </form>
    </div>
  )
}
