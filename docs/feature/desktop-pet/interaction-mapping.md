# AionUi 桌面宠物 — 交互 · 动画 · 事件映射表（校正版）

## 1. AI 事件 → 宠物动画（一对一映射）

### 消息流触发（bridge.adapter.emit hook）

AionUi 各平台实际发出的消息类型（已校正）：

| AI 事件 | 实际 message.type | 宠物状态 | SVG 文件 | 持续 | 实现状态 | 优先级 |
|--------|-------------------|---------|----------|------|---------|--------|
| AI 开始思考 | `thinking` | thinking | thinking.svg | 持续 | ✅ 已实现 | — |
| AI 输出内容 | `text` | working | working.svg | 持续 | ✅ 已实现 | — |
| AI 出错 | `error` | error | error.svg | 5s→idle | ✅ 已实现 | — |
| AI 完成回复 | `finish`（仅 ACP） | happy | happy.svg | 3s→idle | ⚠️ 只有 ACP 有 finish | 🔴 P0 |
| 系统消息 | `system` | — | 不触发 | — | — | — |
| 用户消息回显 | `user_content` | — | 不触发 | — | — | — |
| 请求追踪 | `request_trace` | — | 不触发 | — | — | — |
| 命令更新 | `slash_commands_updated` | — | 不触发 | — | — | — |

**⚠️ finish 类型问题：** Gemini/OpenClaw/Nanobot 没有 `finish` 类型消息。需要通过其他方式检测回复完成（比如 `turnCompleted` 事件或消息流结束）。

### 前置触发（conversationBridge.sendMessage）

| 触发点 | 宠物状态 | 说明 | 实现状态 | 优先级 |
|--------|---------|------|---------|--------|
| 用户按发送的瞬间 | thinking | 不等 AI 回复，立刻反馈 | ✅ 已实现 | — |

### 未接入的 AI 事件

| AI 事件 | 检测方式 | 宠物状态 | SVG | 实现状态 | 优先级 |
|--------|---------|---------|-----|---------|--------|
| 回复完成（非 ACP） | 监听 `turnCompleted` 事件 | happy | happy.svg | ❌ | 🔴 P0 |
| 权限确认请求 | 监听 `confirmation.add` | notification | notification.svg | ❌ | 🟡 P1 |
| 上下文压缩 | 监听 compact 相关消息 | sweeping | sweeping.svg | ❌ | 🟢 P2 |
| 多会话 2+ 活跃 | 统计 workerTaskManager 任务数 | juggling | juggling.svg | ❌ | 🟢 P2 |
| 多会话 3+ 活跃 | 同上 | building | building.svg | ❌ | 🟢 P2 |
| 文件搬运/worktree | 监听相关 IPC | carrying | carrying.svg | ❌ | 🟢 P2 |

---

## 2. 用户交互 → 宠物动画

| 交互 | 宠物状态 | SVG | 持续 | 实现状态 | 优先级 |
|------|---------|-----|------|---------|--------|
| 拖拽中 | dragging | dragging.svg | 拖拽期间 | ✅ 已实现 | — |
| 松手 | 恢复拖拽前状态 | — | — | ✅ 已实现 | — |
| 单击 | attention | attention.svg | 3s→idle | ✅ 已实现 | — |
| 双击左半 | poke-left | poke-left.svg | 2.5s→idle | ❌ | 🟡 P1 |
| 双击右半 | poke-right | poke-right.svg | 2.5s→idle | ❌ | 🟡 P1 |
| 连点 3+ | error | error.svg | 5s→idle | ❌ | 🟡 P1 |
| 右键 → 摸一摸 | attention | attention.svg | 3s→idle | ✅ 已实现 | — |
| 右键 → 调大小 | — | — | — | ✅ 已实现 | — |
| 右键 → 隐藏 | — | — | — | ✅ 已实现 | — |

---

## 3. 空闲行为 → 宠物动画

| 触发条件 | 宠物状态 | SVG | 持续 | 下一步 | 实现状态 | 优先级 |
|---------|---------|-----|------|-------|---------|--------|
| 鼠标静止 20s | random-look 或 random-read | random-look.svg / random-read.svg | 4-8s | idle | ❌ | 🔴 P0 |
| 鼠标静止 60s | yawning | yawning.svg | 3s | dozing | ❌ | 🔴 P0 |
| yawning 结束 | dozing | dozing.svg | 持续 | sleeping | ❌ | 🔴 P0 |
| 鼠标静止 10min | sleeping | sleeping.svg | 持续 | — | ❌ | 🔴 P0 |
| 睡眠中鼠标移动 | waking | waking.svg | 1.5s | idle | ❌ | 🔴 P0 |
| idle 时鼠标移动 | idle（眼球追踪） | idle.svg | 实时 | — | ❌ | 🟢 P2 |

---

## 4. SVG 资产对照表（20 个）

| # | SVG 文件 | 触发来源 | 当前触发方式 | 用了？ | 优先级 |
|---|----------|---------|------------|--------|--------|
| 1 | idle.svg | 默认/回归 | 启动 + auto-return | ✅ | — |
| 2 | thinking.svg | AI thinking + 用户发送 | bridge hook + sendMessage | ✅ | — |
| 3 | working.svg | AI text 输出 | bridge hook | ✅ | — |
| 4 | happy.svg | AI 完成 (finish) | bridge hook（仅 ACP） | ⚠️ 部分 | 🔴 |
| 5 | error.svg | AI 出错 | bridge hook | ✅ | — |
| 6 | attention.svg | 单击 / 摸一摸 | hitWin click + 右键菜单 | ✅ | — |
| 7 | dragging.svg | 拖拽中 | hitWin drag | ✅ | — |
| 8 | sleeping.svg | 托盘菜单 / 空闲 10min | 托盘手动（自动待实现） | ⚠️ 手动 | 🔴 |
| 9 | notification.svg | 权限请求 | — | ❌ | 🟡 |
| 10 | waking.svg | 鼠标唤醒 | — | ❌ | 🔴 |
| 11 | yawning.svg | 空闲 60s | — | ❌ | 🔴 |
| 12 | dozing.svg | yawning 后过渡 | — | ❌ | 🔴 |
| 13 | random-look.svg | 空闲 20s 随机 | — | ❌ | 🔴 |
| 14 | random-read.svg | 空闲 20s 随机 | — | ❌ | 🔴 |
| 15 | sweeping.svg | 上下文压缩 | — | ❌ | 🟢 |
| 16 | building.svg | 3+ 活跃会话 | — | ❌ | 🟢 |
| 17 | juggling.svg | 2+ 活跃会话 | — | ❌ | 🟢 |
| 18 | carrying.svg | 文件搬运 | — | ❌ | 🟢 |
| 19 | poke-left.svg | 双击左半 | — | ❌ | 🟡 |
| 20 | poke-right.svg | 双击右半 | — | ❌ | 🟡 |

---

## 5. 实现优先级时间线

### 🔴 P0 — 做完宠物才算"活的"

```
1. 空闲行为系统（激活 6 个 SVG）
   → tick 循环 + 光标轮询
   → 20s random / 60s yawn / 10min sleep / 鼠标唤醒
   → 预计 30 行代码

2. 非 ACP 平台完成检测
   → 监听 turnCompleted 或检测消息流结束
   → happy 动画对所有平台生效
   → 预计 10 行代码

3. 前置 thinking 验证
   → 确认 sendMessage 瞬间宠物立刻切 thinking
   → 已实现，需验证延迟
```

### 🟡 P1 — 体验更好

```
4. 双击/连点交互
   → hitWin click 加计数器 + 方向检测
   → 预计 15 行代码

5. notification 状态
   → 监听 confirmation.add bridge 事件
   → 预计 5 行代码

6. 设置面板
   → 开关/大小/勿扰
   → 中等工作量
```

### 🟢 P2 — 锦上添花

```
7. 眼睛追踪
8. sweeping / juggling / building / carrying
9. 位置记忆
10. 权限气泡窗口
```

---

## 6. AionUi 可利用的代码触点

### 主进程（已确认可用）

| 触点 | 文件 | 可检测的事件 | 宠物用途 |
|------|------|-----------|---------|
| `bridge.adapter.emit()` hook | `src/common/adapter/main.ts` | 所有 bridge 消息 | thinking/working/happy/error |
| `sendMessage.provider` 入口 | `src/process/bridge/conversationBridge.ts:454` | 用户发送消息 | **前置 thinking** |
| `turnCompleted` 事件 | `ipcBridge.conversation.turnCompleted` | 轮次完成 | **happy（所有平台）** |
| `confirmation.add` 事件 | `ipcBridge.conversation.confirmation.add` | 权限请求 | notification |
| `workerTaskManager.listTasks()` | `src/process/task/workerTaskManagerSingleton.ts` | 活跃任务数 | juggling/building |
| `screen.getCursorScreenPoint()` | Electron API | 光标位置 | 空闲检测/眼睛追踪 |

### 各平台实际消息类型（校正后）

| 平台 | thinking | text | finish | error | 其他 |
|------|---------|------|--------|-------|------|
| ACP | ✅ | ✅ | ✅ | ✅ | system, user_content, request_trace, slash_commands_updated |
| Gemini | ✅ | ✅ | ❌ | ✅ | system, user_content, request_trace |
| OpenClaw | ❌ | ✅ | ❌ | ✅ | — |
| Nanobot | ❌ | ✅ | ❌ | ✅ | — |
| Remote | — | — | — | — | 通过 IpcAgentEventEmitter |

**关键发现：** 只有 ACP 有 `thinking` 和 `finish`。其他平台需要用 `turnCompleted` 来检测完成，用 `sendMessage` 前置来代替 `thinking`。
