# clawd-on-desk 项目总结

## 一句话概括

clawd-on-desk 是一个 **Electron 桌面宠物应用**，以 Claude AI 的形象为基础，浮在桌面最上层，通过 Hook 机制监听 Claude Code/Codex/Gemini CLI 的工作状态，实时展示对应的 SVG 动画，并支持拖拽、点击、右键菜单、眼睛追踪等交互。

---

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│  AI 工具（Claude Code / Codex / Gemini CLI）             │
│  ↓ 触发事件（SessionStart, UserPromptSubmit, Stop...）   │
│  ↓ 运行 hook 脚本（子进程） 或 轮询 JSONL 日志           │
└──────────────┬──────────────────────────────────────────┘
               │ HTTP POST 127.0.0.1:23333
               ▼
┌─────────────────────────────────────────────────────────┐
│  clawd 主进程                                            │
│  ├── server.js — HTTP 服务，接收 hook 上报               │
│  ├── state.js — 状态机（优先级、最短显示、自动回退）       │
│  ├── tick.js — 50ms 轮询循环（光标、空闲、眼睛追踪）      │
│  ├── mini.js — 迷你模式（贴边、探头、抛物线跳跃）         │
│  └── main.js — 窗口管理、IPC 路由、托盘菜单               │
└──────────────┬──────────────────────────────────────────┘
               │ IPC
      ┌────────┴────────┐
      ▼                 ▼
┌──────────┐      ┌──────────┐
│ Render   │      │ Hit      │
│ Window   │      │ Window   │
│ (展示)   │      │ (输入)   │
│ 不收事件  │      │ 收所有事件│
│ SVG 动画  │      │ 空 div   │
└──────────┘      └──────────┘
```

## 关键数据

| 项目 | 数据 |
|------|------|
| SVG 资产 | 38 个独立 .svg 文件 |
| 状态数量 | 23 个（含 8 个迷你模式） |
| 窗口尺寸 | 小 200 / 中 280 / 大 360 px |
| 主循环 | 50ms (20fps) |
| 眼睛追踪 | 最大偏移 3px，300px 衰减 |
| AI 检测延迟 | hook 子进程 + HTTP ≈ 50-200ms |

## AI 事件检测方式

| AI 工具 | 检测方式 | 原理 |
|---------|---------|------|
| Claude Code | Hook 注入 `~/.claude/settings.json` | CLI 每个事件运行 hook 脚本 → HTTP POST |
| Codex CLI | 轮询 JSONL 日志（1.5s 间隔） | 读取 `~/.codex/sessions/` 日志文件 |
| Gemini CLI | Hook 注入 `~/.gemini/settings.json` | 同 Claude Code |
| 网页版 AI | ❌ 不支持 | 没有浏览器扩展 |

## 双窗口架构（核心设计）

| 属性 | Render Window | Hit Window |
|------|--------------|-----------|
| 用途 | 展示 SVG 动画 | 接收所有鼠标事件 |
| focusable | false | false (macOS) |
| setIgnoreMouseEvents | true（永不改） | false（永不改） |
| 大小 | 200-360px | ~87×61px（身体区域） |
| 内容 | `<object>` 加载 SVG | 空 `<div>` |
| 为什么要两个窗口 | macOS 上单窗口无法同时做到"收事件"和"不抢焦点" | |

## 空闲行为系统

```
鼠标活跃 → idle-follow（眼睛追踪光标）
  ↓ 20s 无操作
随机播放: idle-look(6.5s) / working-debugger(14s) / idle-reading(14s)
  ↓ 60s 无操作
yawning(3s) → dozing
  ↓ 10min 无操作
collapsing → sleeping
  ↓ 鼠标移动
waking(1.5s) → idle
```

## 性能秘诀

- **同时只有 1 个 SVG 在内存**（当前显示的）
- **按需加载，不预加载** — 创建新 `<object>` → load 事件 → 替换旧的
- **50ms tick 只做 CPU 计算** — 读光标位置 + 简单数学，零 DOM 操作
- **浏览器 HTTP 缓存** — 第二次加载同一 SVG 是瞬时的
- **状态变化才发 IPC** — tick 里不发 IPC

## 值得借鉴的点

1. **双窗口解决焦点问题** — 单窗口在 macOS 上无解
2. **空闲行为让宠物"活"起来** — 90% 的时间用户没在跟 AI 交互
3. **状态优先级 + 最短显示时间** — 防止高频消息导致动画闪烁
4. **hook 机制外部检测** — 不修改 AI 工具本身的代码
5. **hitBox 动态大小** — 不同状态（站/躺/宽）的点击区域不同
6. **SVG contentDocument 访问** — 不重新加载 SVG 就能操控内部元素（眼睛追踪）
7. **3s 加载超时兜底** — SVG 加载失败保持当前显示

## 我们（AionUi）的优势

| 对比项 | clawd | AionUi |
|--------|-------|--------|
| AI 事件检测 | 外部 hook + HTTP（50-200ms） | 内部 bridge hook（<1ms） |
| 支持平台 | Claude Code / Codex / Gemini CLI | ACP / OpenClaw / Gemini / Codex / Nanobot / Remote（全平台） |
| 网页版 | ❌ | ✅ Gemini/OpenClaw 网页也覆盖 |
| 事件粒度 | 15 个（受限于 hook） | 无限制 |
| 独立安装 | 需要单独安装 clawd app | 内置在 AionUi 里 |
