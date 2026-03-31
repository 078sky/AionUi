# GroupDispatch MCP Tool — Claude Code Agent Tool 对齐说明

## 架构

```
Host AcpAgent (Claude CLI)
  ├── 内置 tools: Read, Edit, Bash, Grep, Agent, ...
  └── MCP tool:   GroupDispatch (HTTP MCP Server, 主进程内 127.0.0.1:随机端口)
                      ↓ tool_use
                  MCP Handler → 创建子 AcpAgent → 执行任务 → tool_result
```

与 Claude Code 的 Agent tool 走完全相同的 `tool_use` / `tool_result` 协议。

## 提示词对齐状态

**结论：除以下 3 处必要差异外，逐字一致。**

### 差异 1：工具名 `Agent` → `GroupDispatch`

原因：避免与 Claude CLI 内置 `Agent` tool 重名冲突。
影响：模型不依赖工具名决定行为，依赖的是 description + schema。无行为差异。

### 差异 2：`SendMessage` → `subagent_type`

原文：`To continue a previously spawned agent, use SendMessage with the agent's ID or name as the \`to\` field.`
改为：`To continue a previously spawned agent, use subagent_type with the agent's ID or name.`

原因：`SendMessage` 是 Claude Code 内置的独立 tool，我们的 MCP server 未注册此 tool，照搬了模型也调不通。通过 `subagent_type` 参数复用已有 agent 是等价的 transport 适配。

### 差异 3：可用 agent 列表内容不同

原文：列出 `general-purpose`, `Explore`, `Plan` 等内置 agent type。
改为：列出当前 Group Room 的成员列表（动态生成）。

原因：Claude Code 的 agent type 列表也是动态生成的（根据用户配置）。结构相同，只是内容不同。

## 相关文件

| 文件                                                      | 职责                                              |
| --------------------------------------------------------- | ------------------------------------------------- |
| `src/process/services/groupRoom/dispatchMcpServer.ts`     | HTTP MCP Server，暴露 GroupDispatch tool          |
| `src/process/services/groupRoom/GroupRoomOrchestrator.ts` | 启动 MCP Server，处理 tool call，管理子 Agent     |
| `src/process/agent/acp/index.ts`                          | `extra.groupDispatchMcpServer` 注入到 session/new |

## 原始参考

Claude Code Agent tool 原文扒取记录见 `docs/feature/group-room-claude-multi-agent-reference.md`。
