# AionUi 桌面宠物 — 独立窗口方案

## 1. 目标

将桌面宠物从页面内 `fixed div` 升级为 **独立透明 Electron 窗口**，浮在桌面所有窗口上方，随 AionUi 启动，不依赖 AionUi 主窗口可见性。

参考：[clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk)（MIT License）

---

## 2. 架构设计

### 2.1 窗口架构

```
┌─────────────────────────────────────────┐
│  AionUi 主窗口（Renderer Process）       │
│  - 对话界面                              │
│  - SendBox 发送消息                      │
│  - 监听 AI 事件 → IPC 发到主进程         │
└──────────────┬──────────────────────────┘
               │ IPC: pet.state
               ▼
┌─────────────────────────────────────────┐
│  Main Process（主进程）                   │
│  - PetWindowManager                      │
│  - 管理宠物窗口生命周期                   │
│  - 转发事件到宠物窗口                     │
│  - 监听空闲/鼠标活动                     │
└──────────────┬──────────────────────────┘
               │ IPC: pet.update
               ▼
┌─────────────────────────────────────────┐
│  Pet BrowserWindow（独立窗口）            │
│  - frameless + transparent              │
│  - alwaysOnTop + skipTaskbar            │
│  - 渲染 SVG 动画                        │
│  - 处理拖拽/点击/右键菜单                │
│  - 眼睛追踪鼠标                         │
└─────────────────────────────────────────┘
```

### 2.2 宠物窗口配置

```typescript
// src/process/pet/PetWindowManager.ts
petWindow = new BrowserWindow({
  width: 160,
  height: 160,
  frame: false,           // 无边框
  transparent: true,      // 透明背景
  alwaysOnTop: true,      // 始终在最前
  skipTaskbar: true,      // 不在任务栏显示
  resizable: false,
  hasShadow: false,
  focusable: false,       // 不抢焦点
  webPreferences: {
    preload: petPreloadPath,
  },
});

// macOS 特殊处理：在全屏应用上方也可见
if (process.platform === 'darwin') {
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setAlwaysOnTop(true, 'screen-saver');
}

// Windows 特殊处理：在任务栏上方
if (process.platform === 'win32') {
  petWindow.setAlwaysOnTop(true, 'pop-up-menu');
}
```

### 2.3 文件结构

```
src/process/pet/                     # 主进程
├── PetWindowManager.ts              # 窗口管理（创建、销毁、位置记忆）
├── PetStateRouter.ts                # 事件路由（AI 事件 → 宠物状态）
└── PetIdleDetector.ts               # 空闲检测（鼠标不动 → 睡眠序列）

src/renderer/pet/                    # 宠物窗口的渲染进程
├── pet.html                         # 宠物窗口入口 HTML
├── PetApp.tsx                       # 宠物渲染根组件
├── PetInteraction.ts                # 拖拽、点击、右键菜单逻辑
├── PetEyeTracker.ts                 # 眼睛追踪鼠标
└── states/                          # 复用现有 SVG 组件
    ├── IdlePet.tsx
    ├── ThinkingPet.tsx
    ├── WorkingPet.tsx
    └── ... (11 个状态)

src/preload/petPreload.ts            # 宠物窗口的 preload 脚本
```

### 2.4 删除/替换

现有的页面内宠物方案将被移除：

```
删除:
  src/renderer/components/layout/DesktopPet/   # 页面内组件全部删除
  Layout.tsx 中的 <PetWidget /> 引用

保留:
  docs/feature/desktop-pet/                    # 设计资产预览文件
  src/renderer/utils/emitter.ts 中的 pet.state 事件
  各 SendBox 中的 emitter.emit('pet.state') 调用
```

---

## 3. AionUi 已有事件 & 宠物状态映射

### 3.1 当前可用的事件源

AionUi 各平台 SendBox 已有的事件（以 OpenClawSendBox 为例）：

| 事件源 | 代码位置 | 当前行为 |
|--------|---------|---------|
| `message.type === 'thought'` | SendBox switch 分支 | 显示思考流 |
| `message.type === 'content'` | SendBox switch 分支 | 添加消息内容 |
| `message.type === 'finish'` | SendBox switch 分支 | 重置 aiProcessing |
| `message.type === 'agent_status'` | SendBox switch 分支 | 显示代理状态 |
| `message.type === 'acp_permission'` | SendBox switch 分支 | 权限确认 |
| `setAiProcessing(true)` | 发送消息时 | 开始加载 |
| `setAiProcessing(false)` | 收到 finish 时 | 结束加载 |
| `conversation.turnCompleted` | IPC emitter | 轮次完成 |
| `conversation.stop` | IPC 方法 | 用户停止 |

### 3.2 推荐的事件 → 宠物状态映射

```typescript
// src/process/pet/PetStateRouter.ts

const EVENT_TO_PET_STATE = {
  // ── AI 对话事件 ──
  'user.prompt.submit':     'thinking',    // 用户发送消息 → 思考中
  'ai.thought':             'thinking',    // 收到 thought 流 → 思考中
  'ai.content.start':       'working',     // 首次收到 content → 工作中
  'ai.tool.call':           'working',     // 工具调用 → 工作中
  'ai.tool.fail':           'error',       // 工具调用失败 → 报错
  'ai.finish':              'happy',       // 回复完成 → 开心
  'ai.error':               'error',       // AI 出错 → 报错
  'ai.stop':                'notification',// 用户主动停止 → 提醒

  // ── 会话生命周期 ──
  'conversation.create':    'waking',      // 新建会话 → 醒来
  'conversation.switch':    'idle',        // 切换会话 → 待机
  'session.end':            'sleeping',    // 关闭所有会话 → 睡觉

  // ── 系统事件（建议新增） ──
  'context.compact':        'sweeping',    // 上下文压缩 → 扫地
  'agent.subagent.start':   'juggling',    // 子代理启动 → 杂耍
  'agent.subagent.stop':    'working',     // 子代理完成 → 回到工作

  // ── 空闲检测（主进程定时器） ──
  'idle.20s':               'sleeping',    // 20秒无操作 → 打盹
  'idle.60s':               'sleeping',    // 60秒无操作 → 深度睡眠
  'mouse.move.after.sleep': 'waking',      // 鼠标移动唤醒 → 伸懒腰
};
```

### 3.3 实现方式

**Renderer → Main Process（事件上报）：**

各 SendBox 已有 `emitter.emit('pet.state', ...)` 调用。改为通过 IPC 桥发到主进程：

```typescript
// 在各 SendBox 的 message handler 中，补充更细粒度的事件：

case 'thought':
  ipcBridge.pet.setState.invoke('thinking');
  break;

case 'content':
  if (!hasContentInTurnRef.current) {
    ipcBridge.pet.setState.invoke('working');
  }
  break;

case 'finish':
  ipcBridge.pet.setState.invoke('happy');
  break;

// 发送消息时：
ipcBridge.pet.setState.invoke('thinking');
```

**Main Process → Pet Window（状态转发）：**

```typescript
// PetWindowManager.ts
ipcMain.handle('pet:setState', (_, state) => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:update', state);
  }
});
```

---

## 4. 交互行为规格

### 4.1 拖拽

| 参数 | 值 | 说明 |
|------|-----|------|
| 拖拽阈值 | 3px | 小于 3px 位移视为点击 |
| 拖拽中动画 | 切换到 `dragging` 状态 | 被拉扯的惊讶表情 |
| 松手回弹 | 150ms ease-out | 回到正常表情 |
| 位置记忆 | 保存到 `userData/pet-prefs.json` | 重启恢复上次位置 |
| 边界限制 | 不允许拖出屏幕 | 贴边吸附 |

### 4.2 点击反应

| 交互 | 反应 | 持续时间 |
|------|------|---------|
| 单击（idle 时） | happy 跳跃 | 4s |
| 双击（400ms 内） | 方向感知偏头（点左半→左偏，点右半→右偏） | 2.5s |
| 3+ 连点 | error 抖动（恼怒） | 3.5s |
| 非 idle 状态点击 | 无反应 | — |

### 4.3 睡眠序列

```
鼠标活跃 → idle（正常呼吸）
    ↓ 20s 无操作
随机 idle 动画（look/read，6-14s）
    ↓ 60s 无操作
yawning 打哈欠（3s）
    ↓ 自动过渡
sleeping 睡觉（zzz 飘浮）
    ↓ 鼠标移动
waking 伸懒腰（5s）→ idle
```

### 4.4 状态优先级

```
error(8) > notification(7) > sweeping(6) > happy(5)
> juggling/building(4) > working(3) > thinking(2)
> waking(2) > idle(1) > sleeping(0)
```

高优先级状态可以打断低优先级。每个状态有最短显示时间，未播完时新状态排队等待。

### 4.5 眼睛追踪

| 参数 | 值 |
|------|-----|
| 轮询频率 | 60fps（requestAnimationFrame） |
| 眼球最大偏移 | 3px |
| 距离衰减 | 300px 范围内线性衰减 |
| 身体跟随 | 眼球偏移的 33% |
| 阴影跟随 | 倾斜方向拉伸 15% |
| 生效状态 | 仅 idle |

### 4.6 右键菜单

```
┌─────────────────────┐
│ 🔍 大小              │
│   ├ 小 (80px)        │
│   ├ 中 (120px) ✓     │
│   └ 大 (160px)       │
├─────────────────────┤
│ 😴 勿扰模式          │
│ 👋 隐藏宠物          │
├─────────────────────┤
│ ℹ️  关于 AionUi Pet  │
└─────────────────────┘
```

---

## 5. 动画资产清单

### 5.1 已有（11 个）

| 状态 | 文件 | 说明 |
|------|------|------|
| idle | IdlePet.tsx | 呼吸+眨眼+微摆 |
| thinking | ThinkingPet.tsx | 侧脸嘟嘴+气泡+光点 |
| working | WorkingPet.tsx | 正面+笔记本+打字 |
| happy | HappyPet.tsx | 跳跃+^^眼+星光 |
| sleeping | SleepingPet.tsx | 深呼吸+zzz飘浮 |
| error | ErrorPet.tsx | 抖动+X眼+帽子飞 |
| notification | NotificationPet.tsx | 惊跳+叹号弹出 |
| waking | WakingPet.tsx | 伸懒腰+双手举+星星爆 |
| sweeping | SweepingPet.tsx | 扫帚+左右摇摆+尘土 |
| building | BuildingPet.tsx | 积木+齿轮旋转+弹跳 |
| juggling | JugglingPet.tsx | 三球抛物线+大笑 |

### 5.2 需要新增（5 个）

| 状态 | 用途 | 动画描述 |
|------|------|---------|
| dragging | 被拖拽时 | 惊讶表情，身体被拉伸，帽子快掉 |
| yawning | 睡前过渡 | 嘴巴张大打哈欠，眼睛眯起 |
| dozing | 半睡半醒 | 头一点一点，比 sleeping 轻 |
| poke-left | 被左侧点击 | 头歪向右看你 |
| poke-right | 被右侧点击 | 头歪向左看你 |

### 5.3 可选新增

| 状态 | 用途 | 动画描述 |
|------|------|---------|
| attention | AI 回复完成的小庆祝 | 比 happy 温和，点头微笑 |
| carrying | 创建 worktree/搬运任务 | 抱着箱子走路 |
| random-look | idle 随机行为 | 左右张望 |
| random-read | idle 随机行为 | 低头看书 |

---

## 6. 实施计划

### Phase 1 — 独立窗口基础（1-2 天）

- [ ] 创建 `PetWindowManager.ts`（主进程，管理宠物窗口生命周期）
- [ ] 创建 `pet.html` + `PetApp.tsx`（宠物窗口渲染）
- [ ] 创建 `petPreload.ts`（IPC 桥接）
- [ ] 将 SVG 状态组件迁移到宠物窗口
- [ ] 删除页面内 PetWidget，改为 IPC 事件上报
- [ ] 基础拖拽 + 位置记忆

### Phase 2 — 交互完善（1-2 天）

- [ ] 点击反应（单击/双击/连点）
- [ ] 睡眠序列（20s→yawning→sleeping, 鼠标唤醒）
- [ ] 状态优先级队列
- [ ] 右键菜单（大小/隐藏/勿扰）
- [ ] 眼睛追踪鼠标

### Phase 3 — AI 事件联动（1 天）

- [ ] 各 SendBox 补充细粒度事件上报（thought/content/finish/error）
- [ ] PetStateRouter 事件映射
- [ ] 空闲检测（PetIdleDetector）

### Phase 4 — 动画补齐（1-2 天）

- [ ] 新增 dragging / yawning / dozing / poke-left / poke-right SVG
- [ ] 随机 idle 行为
- [ ] 设置面板（显示/隐藏/大小/勿扰模式开关）

### Phase 5 — 平台适配 & 打磨（1 天）

- [ ] macOS：visibleOnAllWorkspaces, fullScreen 兼容
- [ ] Windows：pop-up-menu 层级, HWND 恢复 watchdog
- [ ] Linux：toolbar 窗口类型, skipTaskbar 重设
- [ ] 设置持久化（开关、大小、位置、勿扰状态）

---

## 7. 注意事项

1. **仅 Electron 桌面端**：PWA/Web 端无法创建独立窗口，这些环境下不显示宠物
2. **性能**：宠物窗口独立渲染，不影响主窗口性能；空闲时降低刷新率
3. **CSS 动画 vs JS 动画**：SVG 内的 CSS `@keyframes` 在透明窗口中正常工作，无需改用 JS
4. **穿透点击**：透明区域自动穿透（Electron transparent window 默认行为），只有 SVG 内容区域响应鼠标
5. **多显示器**：拖拽支持跨显示器，位置记忆包含显示器标识

---

## 8. 难度评估 & AionUi 架构对接分析

### 8.1 实现难度：中等

| 维度 | 评估 | 说明 |
|------|------|------|
| **窗口层** | ⭐⭐ 简单 | Electron 创建透明窗口是成熟 API，clawd 已验证方案可行 |
| **AI 事件联动** | ⭐ 非常简单 | **AionUi 比 clawd 简单得多** — clawd 作为外部应用需要 hook 注入 + HTTP 轮询，我们的 AI 事件全在自己代码里，直接 IPC emit 即可 |
| **交互系统** | ⭐⭐ 简单 | 拖拽/点击/睡眠都是标准 DOM 事件，已在 interactive-demo 中验证 |
| **平台适配** | ⭐⭐⭐ 中等 | macOS/Windows/Linux 窗口层级行为不同，需要各平台 workaround（clawd 源码可直接参考） |
| **动画资产** | ⭐⭐ 简单 | 11 个状态 SVG 已完成，新增 5 个工作量不大 |
| **状态机** | ⭐⭐ 简单 | 优先级队列 + 最短显示时间已在 demo 中实现 |

**总体评估：5-8 天工作量**（一个熟悉 Electron 的开发者）

### 8.2 AionUi vs clawd：架构差异与我们的优势

clawd 是**外部观察者**，需要用各种 hack 来"偷看"AI 工具内部状态。AionUi 是 **AI 平台本身**，所有事件都是我们自己的。

```
clawd 的事件获取路径（复杂、脆弱）：
  Claude Code → settings.json hook 注入 → 子进程执行 hook 脚本
    → 解析进程树拿 PID → HTTP POST 到 127.0.0.1:23333 → 宠物状态

AionUi 的事件获取路径（简单、可靠）：
  SendBox 收到 message → ipcBridge.pet.setState('thinking')
    → 主进程转发 → 宠物窗口更新
```

| 对比项 | clawd | AionUi |
|--------|-------|--------|
| 事件检测 | Hook 注入 + JSONL 轮询 + HTTP 服务（3 套机制） | 直接在 SendBox 里 emit（1 行代码） |
| 支持的 AI 工具 | Claude Code / Codex CLI / Gemini CLI（仅 CLI） | OpenClaw / Codex / Gemini / Nanobot / ACP / Remote（全平台） |
| 网页端 AI | ❌ 不支持 ChatGPT/Gemini 网页版 | ✅ Gemini 网页也在我们平台内 |
| 事件粒度 | 15 个事件类型（受限于 hook 能暴露的） | 无限制，message.type 任意扩展 |
| 可靠性 | hook 可能被覆盖（需 watchdog）、HTTP 可能端口冲突 | IPC 是 Electron 原生通道，100% 可靠 |
| 延迟 | hook 子进程启动 + HTTP 请求 ≈ 50-200ms | IPC 直连 ≈ <1ms |

**结论：AI 事件联动是我们最大的优势，clawd 最复杂的部分（hooks/server/monitor）我们完全不需要。**

### 8.3 现有 AionUi 架构如何对接

#### 主进程层（src/process/）

AionUi 主进程已有清晰的模块分层：

```
src/process/
├── bridge/          ← 已有 IPC 桥接层，新增 petBridge.ts 即可
├── channels/        ← 消息通道，宠物不需要用
├── agent/           ← AI 代理管理
├── services/        ← 服务层
├── task/            ← 任务管理
└── pet/             ← 【新增】宠物窗口管理
    ├── PetWindowManager.ts
    ├── PetStateRouter.ts
    └── PetIdleDetector.ts
```

**对接点 1 — IPC Bridge**

在 `src/common/adapter/ipcBridge.ts` 中已有 `conversation.*` 系列方法，新增 `pet.*` 系列：

```typescript
// 新增到 ipcBridge
pet: {
  setState: createInvoke<PetState>('pet:setState'),
  getPrefs: createInvoke<PetPrefs>('pet:getPrefs'),
  setPrefs: createInvoke<void>('pet:setPrefs'),
  toggle: createInvoke<void>('pet:toggle'),
}
```

**对接点 2 — 窗口管理**

`src/index.ts` 中创建主窗口的位置（`new BrowserWindow`），在同一层级初始化宠物窗口：

```typescript
// src/index.ts 修改
import { PetWindowManager } from './process/pet/PetWindowManager';

app.whenReady().then(() => {
  createMainWindow();
  PetWindowManager.init();  // 主窗口之后创建宠物窗口
});
```

**对接点 3 — 事件上报**

各 SendBox 已有 `emitter.emit('pet.state', ...)` → 改为 `ipcBridge.pet.setState.invoke(...)`。已改的 5 个文件只需替换一行。

补充更细粒度的事件：在各 SendBox 的 `message handler switch` 中，根据 message.type 映射：

```typescript
// 现有的 switch 分支，只需在每个 case 后加一行：

case 'thought':
  ipcBridge.pet.setState.invoke('thinking');  // ← 加这一行
  // ...existing thought handling...
  break;

case 'finish':
  ipcBridge.pet.setState.invoke('happy');     // ← 加这一行
  // ...existing finish handling...
  break;
```

**对接点 4 — 设置集成**

AionUi 已有 `ConfigStorage` 系统（`src/common/config/storage.ts`），宠物设置直接复用：

```typescript
// 加到 ConfigStorage
'pet.enabled': boolean,
'pet.size': 'small' | 'medium' | 'large',
'pet.position': { x: number, y: number },
'pet.dnd': boolean,
```

### 8.4 需要注意的坑（来自 clawd 踩过的）

| 坑 | clawd 的解法 | 我们的对策 |
|----|-------------|-----------|
| **macOS 全屏模式下宠物消失** | `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` + NSWindowCollectionBehavior 重设 | 直接照搬，加 `reapplyMacVisibility()` |
| **Windows 窗口层级被重置** | 5 秒 watchdog 定时 `setAlwaysOnTop(true, 'pop-up-menu')` | 照搬 watchdog 机制 |
| **Linux skipTaskbar 不生效** | 每次 `showInactive()` 后重新 `setSkipTaskbar(true)` | 照搬 |
| **透明窗口穿透问题** | 双窗口架构（render + hit），hit 窗口专门处理输入 | **我们用单窗口即可** — clawd 的双窗口是因为要在 Linux 上兼容 WM，AionUi 用户群偏 macOS/Windows，单窗口方案更简单 |
| **拖拽时 pointermove 丢失** | `setPointerCapture()` + 在 document 上监听 | 标准方案，照搬 |
| **窗口焦点抢占** | `focusable: false` + `setFocusable(false)` | 照搬 |

---

## 9. 优化建议

### 9.1 比 clawd 做得更好的方向

**① 更丰富的 AI 事件映射**

clawd 受限于 hook 机制，只能拿到 15 个粗粒度事件。我们可以做到：

```
- token 级别的流式反馈（content chunk 到达时宠物打字加速）
- 多轮对话感知（第 1 轮 vs 第 10 轮显示不同疲惫程度）
- 模型切换感知（切换到 GPT-4 时宠物换表情）
- 工具调用类型感知（文件读取 vs 代码执行显示不同动画）
- 错误类型感知（网络错误 vs 余额不足 vs 模型拒绝 显示不同反应）
```

**② 平台个性化**

不同 AI 平台可以有轻微差异的行为：

```
- OpenClaw 平台：宠物帽子变成 Claude 标志色
- Gemini 平台：宠物帽子变成蓝色
- Codex 平台：宠物旁边出现终端图标
```

**③ 用户自定义**

clawd 没有自定义选项，我们可以加：

```
- 自定义宠物大小（滑块）
- 自定义透明度
- 自选帽子颜色
- 导入自定义 SVG（高级用户）
- 动画速度调节
```

**④ 与 AionUi 设置面板深度集成**

在 AionUi 的设置页面加一个「桌面宠物」tab：

```
设置 > 显示 > 桌面宠物
├── 开关：启用/禁用
├── 大小：小/中/大
├── 勿扰模式：开/关
├── AI 联动：开/关（关闭后只做 idle/sleep）
├── 透明度：滑块 30%-100%
└── 重置位置：按钮
```

**⑤ 数据统计（彩蛋）**

记录宠物的生活数据，在右键菜单展示：

```
🐾 AionUi Pet 今日状态
  工作了 3 小时 42 分钟
  思考了 156 次
  开心了 23 次
  睡了 2 次
  被你戳了 7 次
```

### 9.2 建议不做的（避免过度工程）

| 不建议 | 原因 |
|--------|------|
| 迷你模式（贴边缩小） | 开发量大，用户不一定需要，可后续加 |
| 抛物线跳跃物理 | 纯锦上添花，优先级低 |
| 多宠物系统 | 复杂度高，MVP 不需要 |
| 语音交互 | 脱离核心场景 |
| 自定义动画编辑器 | 工程量极大，不值得 |

---

## 10. 用户发现 & 管理宠物

### 10.1 发现入口（3 个触达点）

| 入口 | 位置 | 时机 | 说明 |
|------|------|------|------|
| **首次启动引导** | 主窗口中央弹出引导卡片 | 新安装 / 功能上线后首次打开 | 一次性，关闭后不再弹出 |
| **设置面板** | 设置 → 显示 → 桌面宠物 | 用户主动探索 | 常驻入口，完整管理 |
| **托盘菜单** | 系统托盘右键 → 桌面宠物 开/关 | 快捷操作 | 仅开关，不打开设置面板 |

### 10.2 首次启动引导卡片

用户首次接触桌面宠物时弹出的引导卡片，展示宠物形象和核心功能：

```
┌─────────────────────────────────────┐
│  🎉 认识你的新伙伴！                 │
│                                     │
│     ┌─────────┐                     │
│     │         │                     │
│     │  idle   │  ← 宠物动画实时预览  │
│     │  动画    │                     │
│     │         │                     │
│     └─────────┘                     │
│                                     │
│  它会陪你一起工作：                   │
│  · AI 思考时它也在思考               │
│  · AI 回复完它会开心                 │
│  · 闲着没事它会打盹                  │
│  · 你可以拖它、戳它、摸它            │
│                                     │
│  [开启桌面宠物]    [以后再说]        │
└─────────────────────────────────────┘
```

**实现要点：**
- 使用 `ConfigStorage` 的 `pet.onboardShown` 标记是否已展示
- 点击「开启桌面宠物」→ 设置 `pet.enabled = true` + 创建宠物窗口
- 点击「以后再说」→ 关闭卡片，用户可从设置面板手动开启
- 引导卡片内嵌 IdlePet 组件实时动画，不是静态图

### 10.3 设置面板

在 AionUi 现有的 **设置 → 显示设置** 页面中，新增「桌面宠物」区块（跟主题/背景同级）：

```
┌──────────────────────────────────────────────┐
│ 显示设置                                      │
├──────────────────────────────────────────────┤
│ 主题 ...................... [当前主题]        │
│ 背景 ...................... [自定义背景]      │
│                                              │
│ ── 桌面宠物 ──────────────────────────────── │
│                                              │
│ 启用桌面宠物                   [开关 ●]      │
│                                              │
│ ┌──────────┐  大小     ○ 小(200) ● 中(280)  │
│ │          │           ○ 大(360)             │
│ │  (实时   │                                 │
│ │  预览)   │  AI 联动     [开关 ●]           │
│ │          │  当 AI 工作时宠物同步反应         │
│ │          │                                 │
│ └──────────┘  眼睛跟随鼠标  [开关 ●]         │
│               idle 时眼球跟随光标             │
│                                              │
│               勿扰模式     [开关 ○]           │
│               关闭所有自动状态切换             │
│                                              │
│               重置位置     [按钮]             │
│               将宠物移回屏幕右下角             │
│                                              │
│ ── 统计 ─────────────────────────────────── │
│                                              │
│  🐾 今日陪伴                                 │
│  工作时长  3h 42min                          │
│  思考次数  156 次                             │
│  开心次数  23 次                              │
│  被戳次数  7 次                               │
│  打盹次数  2 次                               │
│                                              │
└──────────────────────────────────────────────┘
```

**设置项说明：**

| 设置项 | ConfigStorage 键 | 默认值 | 说明 |
|--------|-----------------|-------|------|
| 启用桌面宠物 | `pet.enabled` | `true` | 主开关，关闭后销毁宠物窗口 |
| 大小 | `pet.size` | `'medium'` | `small(240)` / `medium(320)` / `large(440)` |
| AI 联动 | `pet.aiSync` | `true` | 关闭后不响应 AI 事件，仅 idle/sleep |
| 眼睛跟随鼠标 | `pet.eyeTracking` | `true` | 关闭后 idle 时眼睛不动 |
| 勿扰模式 | `pet.dnd` | `false` | 开启后不自动切换状态 |
| 位置 | `pet.position` | `{x: -1, y: -1}` | `-1` 表示默认右下角 |
| 引导已展示 | `pet.onboardShown` | `false` | 首次引导卡片展示标记 |

### 10.4 托盘菜单集成

在 AionUi 现有的系统托盘菜单中追加一项：

```
┌─────────────────────┐
│ 新建对话             │
│ 最近对话 ▸           │
├─────────────────────┤
│ 桌面宠物   ✓         │  ← 新增，勾选 = 已开启
├─────────────────────┤
│ 暂停所有任务         │
│ 检查更新             │
│ 关于 AionUi          │
│ 退出                 │
└─────────────────────┘
```

**实现要点：**
- 复用 AionUi 已有的 tray 事件系统（`tray:*` CustomEvent）
- 点击切换 `pet.enabled`，立即创建/销毁宠物窗口
- 菜单项带勾选标记反映当前状态

### 10.5 宠物右键菜单（桌面窗口上）

用户直接在桌面宠物上右键弹出的快捷菜单：

```
┌─────────────────────┐
│ 🤗 摸一摸            │
├─────────────────────┤
│ 🔹 小               │
│ 🔸 中  ✓            │
│ 🔶 大               │
├─────────────────────┤
│ 🔕 勿扰模式         │
│ 👋 隐藏宠物          │
├─────────────────────┤
│ ⚙️ 宠物设置          │  ← 跳转到设置面板
└─────────────────────┘
```

**与设置面板的关系：**
- 右键菜单是**快捷操作**，只暴露最常用的几项
- 「⚙️ 宠物设置」点击后打开 AionUi 主窗口并导航到设置 → 显示 → 桌面宠物
- 所有修改通过 `ConfigStorage` 同步，右键改的设置面板也能看到

### 10.6 文件结构（设置相关）

```
src/renderer/pages/settings/DisplaySettings/
├── index.tsx                    # 已有，显示设置页面
├── PetSettings.tsx              # 【新增】桌面宠物设置区块
└── PetSettings.module.css       # 【新增】样式

src/renderer/components/pet/
├── PetOnboardCard.tsx           # 【新增】首次引导卡片
└── PetOnboardCard.module.css    # 【新增】样式

src/process/pet/
└── PetWindowManager.ts          # 监听 pet.enabled 变化，创建/销毁窗口
```

---

## 11. 设计资产规范 & 生产流程

### 11.1 当前问题

现在的设计资产存在几个问题：

1. **没有统一基准造型** — 各状态的身体形状、帽子样式、手的形态不一致，导致状态切换时造型跳变
2. **两套风格混在一起** — 部分状态用用户设计稿（三角帽 path、圆形手），部分用自画的（polygon 帽、菱形手）
3. **资产嵌在 demo HTML 里** — 没有独立文件，不方便管理和复用
4. **没有 JS 控制锚点** — SVG 元素没有 id，无法从外部控制眼睛追踪等动态效果

### 11.2 clawd 的做法（参考）

clawd 的 39 个 SVG 资产遵循清晰的规范：

```
assets/svg/
├── clawd-static-base.svg         ← 基准造型（无动画，定义所有部件位置）
├── clawd-idle-follow.svg         ← 每个状态一个独立文件
├── clawd-working-typing.svg
├── clawd-sleeping.svg
└── ...
```

每个 SVG 文件：
- **自包含**：造型 + CSS 动画在同一个文件里
- **基于基准造型派生**：身体/帽子/手的基础坐标一致
- **关键元素有 id**：`id="eyes-js"` / `id="body-js"` / `id="shadow-js"` 供 JS 外部操控
- **统一 viewBox**：所有文件共享同一个坐标体系

### 11.3 我们的资产规范（建议）

#### 基准造型文件

创建 `pet-static-base.svg` 定义所有部件的标准位置和样式：

```svg
<!-- assets/pet/pet-static-base.svg — 基准造型，所有状态从这里派生 -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 23" width="300" height="300">
  <!-- 阴影 -->
  <ellipse id="shadow-js" cx="10.5" cy="21" rx="5" ry="0.6" fill="#c0c0c0" opacity="0.3"/>
  
  <!-- 身体组 -->
  <g id="body-js">
    <!-- 左手 -->
    <rect id="hand-left" x="2" y="14" width="3" height="3" rx="1.5"
          fill="#97A0C5" fill-opacity="0.7"/>
    <!-- 身体 -->
    <rect id="torso" x="5" y="7" width="12" height="12" rx="6" fill="#97A0C5"/>
    <!-- 帽子 -->
    <path id="hat" d="M14.2 6.85L7.8 6.85L11 1.3L14.2 6.85Z" fill="#FF5B24"/>
    <!-- 右手 -->
    <ellipse id="hand-right" cx="18" cy="14" rx="1.5" ry="1.5" fill="#B9C3EB"/>
  </g>
  
  <!-- 表情组 -->
  <g id="face-js">
    <!-- 眼睛 -->
    <g id="eyes-js">
      <rect id="eye" x="10" y="11" width="2" height="2" rx="1" fill="black"/>
    </g>
    <!-- 嘴巴 -->
    <path id="mouth" d="M9 14C9.95 15.43 12.05 15.43 13 14"
          stroke="black" stroke-linecap="round" fill="none"/>
  </g>
</g>
```

#### 标准规范

| 规范 | 值 | 说明 |
|------|-----|------|
| viewBox | `0 0 21 23`（设计坐标）或 `-18 -18 58 58`（显示坐标） | 需统一选一个 |
| 身体 | `rect x=5 y=7 w=12 h=12 rx=6` fill=#97A0C5 | 圆角正方形 |
| 帽子 | `path` 三角形 fill=#FF5B24 | 用用户设计稿的造型 |
| 左手 | `rect rx=1.5` fill=#97A0C5 opacity=0.7 | 灰色圆形 |
| 右手 | `ellipse` fill=#B9C3EB | 浅蓝色圆形 |
| 眼睛 | `rect rx=1` fill=black | 单眼，圆角方块 |
| 嘴巴 | `path` 弧线 stroke=black | 微笑弧线 |
| 阴影 | `ellipse` fill=#c0c0c0 opacity=0.3 | 底部椭圆 |

#### JS 控制锚点

每个 SVG 必须保留以下 id，供外部 JS 操控：

| id | 用途 | 外部操作 |
|----|------|---------|
| `eyes-js` | 眼睛组 | 鼠标追踪时 translate 偏移 |
| `body-js` | 身体组 | 鼠标追踪时微倾 |
| `shadow-js` | 阴影 | 鼠标追踪时拉伸 |
| `face-js` | 表情组 | 状态切换时整体控制 |

### 11.4 资产目录结构

```
assets/pet/
├── pet-static-base.svg              ← 基准造型（无动画）
├── states/
│   ├── idle.svg                     ← 每个状态一个独立 SVG
│   ├── thinking.svg
│   ├── working.svg
│   ├── happy.svg
│   ├── sleeping.svg
│   ├── waking.svg
│   ├── error.svg
│   ├── notification.svg
│   ├── dragging.svg
│   ├── yawning.svg
│   ├── dozing.svg
│   ├── sweeping.svg
│   ├── building.svg
│   ├── juggling.svg
│   ├── carrying.svg
│   ├── attention.svg
│   ├── poke-left.svg
│   ├── poke-right.svg
│   ├── random-look.svg
│   └── random-read.svg
└── docs/
    ├── pet-demo-v6.html             ← 设计预览（保留）
    └── pet-interactive-demo.html    ← 交互预览（保留）
```

### 11.5 从资产到代码的完整流程

```
┌───────────────────────────────────────────────────────────┐
│  Step 1: 设计基准                                          │
│  创建 pet-static-base.svg                                  │
│  定义身体/帽子/手/眼/嘴的标准位置和颜色                      │
└──────────────┬────────────────────────────────────────────┘
               ▼
┌───────────────────────────────────────────────────────────┐
│  Step 2: 派生各状态 SVG                                    │
│  基于基准造型，调整姿势+加道具+写 CSS 动画                   │
│  每个状态导出为独立 .svg 文件                                │
│  保留 id="eyes-js" 等锚点                                   │
└──────────────┬────────────────────────────────────────────┘
               ▼
┌───────────────────────────────────────────────────────────┐
│  Step 3: 验证预览                                          │
│  在 pet-demo-v6.html 中排列查看所有状态                     │
│  在 pet-interactive-demo.html 中测试交互+状态切换           │
│  确认状态之间切换不跳变                                      │
└──────────────┬────────────────────────────────────────────┘
               ▼
┌───────────────────────────────────────────────────────────┐
│  Step 4: 集成到 Electron 宠物窗口                          │
│                                                           │
│  方案 A: <object> 标签加载 SVG（clawd 的做法）              │
│  ┌─ pet.html ──────────────────────────────────────┐      │
│  │ <object id="pet" type="image/svg+xml"           │      │
│  │         data="assets/pet/states/idle.svg"/>      │      │
│  │                                                  │      │
│  │ 切换状态 → 修改 data 属性指向不同 SVG 文件         │      │
│  │ 眼睛追踪 → contentDocument.getElementById        │      │
│  └──────────────────────────────────────────────────┘      │
│                                                           │
│  方案 B: innerHTML 注入 SVG 字符串（我们 demo 的做法）      │
│  ┌─ pet.html ──────────────────────────────────────┐      │
│  │ const SVGS = { idle: '...', working: '...' }    │      │
│  │ container.innerHTML = SVGS[state]                │      │
│  │                                                  │      │
│  │ 切换状态 → 替换 innerHTML                         │      │
│  │ 眼睛追踪 → querySelector                         │      │
│  └──────────────────────────────────────────────────┘      │
│                                                           │
│  方案 C: React 组件（当前 TSX 方案）                        │
│  ┌─ PetApp.tsx ────────────────────────────────────┐      │
│  │ const Component = STATE_COMPONENTS[state]        │      │
│  │ return <Component />                             │      │
│  │                                                  │      │
│  │ 切换状态 → React 重新渲染                         │      │
│  │ 眼睛追踪 → ref + DOM 操作                        │      │
│  └──────────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

### 11.6 三种集成方案对比

| | 方案 A: `<object>` 加载 SVG | 方案 B: innerHTML 注入 | 方案 C: React TSX 组件 |
|---|---|---|---|
| **clawd 用的** | ✅ | | |
| **资产格式** | 独立 .svg 文件 | JS 字符串模板 | TSX 组件 |
| **眼睛追踪** | `contentDocument.getElementById` | `querySelector` | ref + DOM |
| **状态切换** | 改 `data` 属性 | 替换 innerHTML | React 重渲染 |
| **SVG 加载** | 异步（需等 load 事件） | 同步（立即可用） | 同步 |
| **设计师友好** | ✅ 直接编辑 .svg 文件 | ❌ 要改 JS 字符串 | ❌ 要改 TSX |
| **CSS 隔离** | ✅ 天然隔离（各文件独立） | ❌ class 名可能冲突 | ❌ 同上 |
| **构建依赖** | 无（静态文件） | 无 | 需要 React + 打包 |
| **宠物窗口适配** | 最简单 | 简单 | 需要给宠物窗口配 React |

**推荐：方案 A（`<object>` 加载独立 SVG）**

理由：
1. clawd 已验证可行，直接参考
2. 设计师友好——改 SVG 文件就行，不用碰代码
3. CSS 动画天然隔离，不用担心 class 名冲突
4. 宠物窗口是独立 BrowserWindow，不需要 React 那套打包体系
5. 眼睛追踪通过 `contentDocument` 访问 SVG 内部元素，clawd 的代码可直接参考

### 11.7 下一步行动

```
1. 创建 pet-static-base.svg（基准造型）
   → 统一所有部件的位置、颜色、比例
   → 基于用户设计稿风格

2. 基于基准，重做所有 20 个状态 SVG
   → 每个状态一个独立 .svg 文件
   → 统一 viewBox、帽子、手的造型
   → 保留 id 锚点

3. 更新 demo 验证
   → pet-demo-v6.html 用独立 SVG 文件
   → pet-interactive-demo.html 用 <object> 加载

4. 实现 Electron 宠物窗口
   → pet.html 用 <object> 加载 SVG
   → PetWindowManager.ts 管理窗口
   → 切换状态 = 切换 <object> 的 data 属性
```
