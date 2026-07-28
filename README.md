# 🚀 LAN Transfer - 极速局域网文件传输工具

![GitHub release](https://img.shields.io/badge/Release-v1.2.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Windows-orange.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

[![Download Windows EXE](https://img.shields.io/badge/Download-Windows_EXE-blue?style=for-the-badge&logo=windows&logoColor=white)](releases/LAN%20Transfer_Setup_1.2.0.exe)

**LAN Transfer** 是一款基于 Electron + React + TypeScript + Vite + Tailwind CSS 构建的高颜值局域网文件传输工具。不仅支持 PC 客户端间极速 P2P 文件互传，还支持**手机免安装 APP 扫码一键互传**，在局域网内实现零配置、多端全平台文件传输体验。

---

## 界面预览

|               ☀️ 白天模式               |              🌙 黑夜模式               |
| :-------------------------------------: | :------------------------------------: |
| ![白天模式](docs/images/main_light.png) | ![黑夜模式](docs/images/main_dark.png) |

---

## 核心特性

- **🚀 零磁盘 IO 局域网通道纯网络测速 (v1.2.0 新增)**：支持一键对 PC 或手机进行物理带宽网速测试，采用内存复用 Buffer 不写磁盘，精细显示实时 Mbps 滚牌与网络瓶颈诊断提示。
- **📱 手机免安装 APP 扫码互传**：开启网页共享服务，手机连接同一 WiFi 扫描二维码即可在浏览器中与 PC 或其它设备互发文件，完美适配 iOS Safari 与 Android Chrome。
- **⚡ 极速 P2P 传输与 4MB 写缓冲**：局域网内点对点直接建立 TCP 高速通道，内部扩展 4MB 内存写缓冲与背压控制，大幅降低磁盘寻道阻塞。
- **🔍 动态设备感知与雷达图**：集成 mDNS 组播广播与局域网段 TCP 轮询，打开软件即刻自动扫描显示周围所有在线电脑与手机，支持显示局域网 IP 与一键点击发送。
- **🔒 目标设备隐私隔离防护**：针对多设备并发情况实现精准的目标 IP 隔离传输，被测速设备保持绝对静默，防止接收文件误发或泄漏；包含防目录穿越安全策略。
- **🎨 灵动岛状态与多主题交互**：基于 iOS 灵动岛风格的状态监控，支持实时速率/剩余时间计算、白天与黑夜高对比度主题自由切换。

---

## 下载与安装

### 📥 快速下载

您可以选择以下方式下载 Windows 客户端安装包：

- [**`LAN Transfer_Setup_1.2.0.exe` (最新稳定版)**](releases/LAN%20Transfer_Setup_1.2.0.exe)
- [查看所有历史发行版本 (Releases 页面)](../../releases)

### 💿 安装步骤

1. 点击上述链接下载最新的安装包 [**`LAN Transfer_Setup_1.2.0.exe`**](releases/LAN%20Transfer_Setup_1.2.0.exe)。
2. 双击运行，在安装向导中您可以选择安装到任意自定义路径（如 `D:\Program Files\LAN Transfer`）。
3. 安装完成后，双击桌面生成的 **`LAN Transfer`** 快捷方式即可开启使用。
4. 如需与手机互传，点击侧边栏 **“手机扫码互传”**，使用手机扫码即可使用。

---

## 使用指南

### 1. 发现设备与雷达交互
打开软件后，雷达面板会自动扫描并展示局域网内所有在线的 PC 与手机设备（带有设备类型标识与局域网 IP 地址）。

### 2. 发送文件
- **PC -> PC / 手机**：直接在雷达图或设备列表上点击目标设备（如“iPhone 15 [192.168.1.102]”），在弹出的文件框中挑选文件即可即时发送。
- **IP 直连**：如果在极特殊网络环境下未能看到设备，可在软件底部手动输入对方局域网 IP（如 `192.168.0.106`），点击“直接连接”发起传输。

### 3. 手机免 APP 互传
桌面端点击侧边栏 **“手机扫码互传”** 展开二维码，手机自带相机扫码打开网页即可直接向 PC 或其他手机发送文件，并在“可下载文件”区一键保存文件。

---

## 常见网络与防火墙问题排查

如果您在传输时遇到“找不到设备”或“无法接收”，请检查接收方电脑的以下网络配置：

### 1. 将网络类型切换为“专用网络”
- Windows 默认在“公用网络”下会封锁局域网互连。
- **操作**：点击电脑右下角的网络图标 -> 属性 -> 将网络配置文件类型由“公用”改为 **“专用”**。

### 2. 检查第三方安全软件拦截（如火绒、360）
- **操作**：尝试暂时关闭或退出第三方防护软件，或在防护软件的“网络防护/主动防御”中将 `LAN Transfer` 及 `12138` / `12139` 端口加入放行白名单。

### 3. 以管理员身份开放端口
若系统防火墙提示“此设置由您的组织管理”：
1. 以管理员身份运行 `cmd`。
2. 执行以下命令放行端口：
   ```cmd
   netsh advfirewall firewall add rule name="LAN-Transfer-TCP" dir=in action=allow protocol=TCP localport=12138,12139 program="%LocalAppData%\Programs\LAN Transfer\LAN Transfer.exe"
   ```

---

## 开发者指南

如果您想自行修改代码并进行本地调试或打包：

### 1. 安装依赖
```bash
npm install
```

### 2. 开发环境调试
```bash
npm run dev
```

### 3. 编译打包出 Windows 安装包
```bash
npm run build
```

打包输出的完整安装包将自动生成在 `releases/` 目录下。
