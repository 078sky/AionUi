/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/process/task/dispatch/DispatchMcpServer.ts

import path from 'node:path';
import type {
  StartChildTaskParams,
  ReadTranscriptOptions,
  TranscriptResult,
  ChildTaskInfo,
  SendMessageToChildParams,
  ListSessionsParams,
} from './dispatchTypes';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/**
 * Tool handler interface that the DispatchAgentManager implements.
 * The MCP server delegates tool calls to these handlers.
 */
export type DispatchToolHandler = {
  parentSessionId: string;
  startChildSession(params: StartChildTaskParams): Promise<string>;
  readTranscript(options: ReadTranscriptOptions): Promise<TranscriptResult>;
  listChildren(): Promise<ChildTaskInfo[]>;
  // Phase 2a additions:
  sendMessageToChild(params: SendMessageToChildParams): Promise<string>;
  listSessions(params: ListSessionsParams): Promise<string>;
  // G2 additions:
  stopChild(sessionId: string, reason?: string): Promise<string>;
  askUser(params: { question: string; context?: string; options?: string[] }): Promise<string>;
  // G4.7: Cross-session memory
  saveMemory(entry: { type: string; title: string; content: string }): Promise<string>;
  // Gap-3: Channel isolation — dispatcher sends user-facing messages through this
  sendUserMessage?(message: string): Promise<string>;
};

/**
 * Manages a dispatch MCP server child process.
 * The MCP server provides start_task, read_transcript, send_message,
 * and list_sessions tools to the Gemini CLI running in the dispatcher worker.
 *
 * Architecture:
 *   [Gemini CLI Worker] <--stdio MCP--> [MCP Server Process] <--IPC--> [Main Process (handler)]
 */
export class DispatchMcpServer {
  private handler: DispatchToolHandler;
  private disposed = false;

  constructor(handler: DispatchToolHandler) {
    this.handler = handler;
  }

  /**
   * Handle a tool call from the MCP server child process.
   * This is called via IPC when the Gemini CLI invokes an MCP tool.
   */
  async handleToolCall(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) {
      throw new Error('MCP server has been disposed');
    }

    switch (tool) {
      case 'start_task': {
        const params: StartChildTaskParams = {
          prompt: String(args.prompt ?? ''),
          title: String(args.title ?? 'Untitled Task'),
        };

        // Parse agent_type if provided
        if (typeof args.agent_type === 'string' && args.agent_type.trim()) {
          params.agent_type = args.agent_type.trim() as (typeof params)['agent_type'];
        }

        // Parse member_id if provided
        if (typeof args.member_id === 'string' && args.member_id.trim()) {
          params.member_id = args.member_id.trim();
        }

        // Parse isolation if provided
        if (args.isolation === 'worktree') {
          params.isolation = 'worktree';
        }

        // Parse teammate config if provided
        if (args.teammate && typeof args.teammate === 'object') {
          const t = args.teammate as Record<string, unknown>;
          params.teammate = {
            id: String(t.id ?? `teammate_${Date.now()}`),
            name: String(t.name ?? 'Assistant'),
            avatar: t.avatar ? String(t.avatar) : undefined,
            presetRules: t.presetRules ? String(t.presetRules) : undefined,
            agentType: params.agent_type || 'gemini',
            createdAt: Date.now(),
          };
        }

        // F-6.1: Parse workspace override if provided
        if (typeof args.workspace === 'string' && args.workspace.trim()) {
          params.workspace = args.workspace.trim();
        }

        // F-4.2: Parse model override if provided
        if (args.model && typeof args.model === 'object') {
          const m = args.model as Record<string, unknown>;
          const providerId = String(m.provider_id ?? '').trim();
          const modelName = String(m.model_name ?? '').trim();
          if (providerId && modelName) {
            params.model = { providerId, modelName };
          }
        }

        // G2.2: Parse allowed_tools if provided
        if (Array.isArray(args.allowed_tools)) {
          params.allowedTools = args.allowed_tools.map(String).filter(Boolean);
        }

        const sessionId = await this.handler.startChildSession(params);
        const children = await this.handler.listChildren();
        const existingList = children.map((c) => `- ${c.title} (${c.sessionId}): ${c.status}`).join('\n');

        return {
          session_id: sessionId,
          message: `Task started. Session ID: ${sessionId}\n\nExisting tasks:\n${existingList}`,
        };
      }

      // Gap-5: start_code_task — start_task with worktree isolation by default
      case 'start_code_task': {
        const params: StartChildTaskParams = {
          prompt: String(args.prompt ?? ''),
          title: String(args.title ?? 'Code Task'),
          isolation: 'worktree',
        };

        // Parse optional workspace
        if (typeof args.workspace === 'string' && args.workspace.trim()) {
          params.workspace = args.workspace.trim();
        }

        // Parse agent_type if provided
        if (typeof args.agent_type === 'string' && args.agent_type.trim()) {
          params.agent_type = args.agent_type.trim() as (typeof params)['agent_type'];
        }

        // Parse member_id if provided
        if (typeof args.member_id === 'string' && args.member_id.trim()) {
          params.member_id = args.member_id.trim();
        }

        // Parse teammate config if provided
        if (args.teammate && typeof args.teammate === 'object') {
          const t = args.teammate as Record<string, unknown>;
          params.teammate = {
            id: String(t.id ?? `teammate_${Date.now()}`),
            name: String(t.name ?? 'Coder'),
            avatar: t.avatar ? String(t.avatar) : undefined,
            presetRules: t.presetRules ? String(t.presetRules) : undefined,
            agentType: params.agent_type || 'gemini',
            createdAt: Date.now(),
          };
        }

        const sessionId = await this.handler.startChildSession(params);
        const children = await this.handler.listChildren();
        const existingList = children.map((c) => `- ${c.title} (${c.sessionId}): ${c.status}`).join('\n');

        return {
          session_id: sessionId,
          message: `Code task started with worktree isolation. Session ID: ${sessionId}\n\nExisting tasks:\n${existingList}`,
        };
      }

      case 'read_transcript': {
        const options: ReadTranscriptOptions = {
          sessionId: String(args.session_id ?? ''),
          limit: typeof args.limit === 'number' ? args.limit : undefined,
          maxWaitSeconds: typeof args.max_wait_seconds === 'number' ? args.max_wait_seconds : undefined,
          format: args.format === 'full' ? 'full' : 'auto',
        };

        const result = await this.handler.readTranscript(options);
        return {
          session_id: result.sessionId,
          title: result.title,
          status: result.status,
          is_running: result.isRunning,
          transcript: result.transcript,
        };
      }

      // F-2.2: list_sessions replaces list_children
      case 'list_sessions': {
        mainLog('[DispatchMcpServer:list_sessions]', `parentId=${this.handler.parentSessionId}`);
        const limit = typeof args.limit === 'number' ? args.limit : 20;
        const result = await this.handler.listSessions({ limit });
        mainLog('[DispatchMcpServer:list_sessions]', `success, parentId=${this.handler.parentSessionId}`);
        return { content: [{ type: 'text', text: result }] };
      }

      // C-PM-2a-008: Keep list_children as deprecated alias
      case 'list_children': {
        mainWarn('[DispatchMcpServer:list_children]', 'Deprecated: use list_sessions instead');
        const result = await this.handler.listSessions({ limit: 20 });
        return { content: [{ type: 'text', text: result }] };
      }

      // F-2.1: send_message tool
      case 'send_message': {
        const sessionId = String(args.session_id ?? '');
        const message = String(args.message ?? '');
        mainLog(
          '[DispatchMcpServer:send_message]',
          `received: childId=${sessionId}, parentId=${this.handler.parentSessionId}`
        );

        if (!sessionId || !message) {
          return {
            content: 'session_id and message are required',
            isError: true,
          };
        }

        try {
          const resultMsg = await this.handler.sendMessageToChild({
            sessionId,
            message,
          });
          mainLog('[DispatchMcpServer:send_message]', `success: childId=${sessionId}`);
          return {
            session_id: sessionId,
            message: resultMsg,
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          mainWarn('[DispatchMcpServer:send_message]', `failed: childId=${sessionId}, error=${errMsg}`);
          return {
            content: `Failed to send message: ${errMsg}`,
            isError: true,
          };
        }
      }

      // G2.3: stop_child tool
      case 'stop_child': {
        const sessionId = String(args.session_id ?? '');
        const reason = typeof args.reason === 'string' ? args.reason : undefined;

        if (!sessionId) {
          return { content: 'session_id is required', isError: true };
        }

        try {
          const result = await this.handler.stopChild(sessionId, reason);
          return { session_id: sessionId, message: result };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { content: `Failed to stop child: ${errMsg}`, isError: true };
        }
      }

      // G2.4: ask_user tool
      case 'ask_user': {
        const question = String(args.question ?? '');
        const context = typeof args.context === 'string' ? args.context : undefined;
        const options = Array.isArray(args.options) ? args.options.map(String) : undefined;

        if (!question) {
          return { content: 'question is required', isError: true };
        }

        try {
          const result = await this.handler.askUser({ question, context, options });
          return { message: result };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { content: `Failed to ask user: ${errMsg}`, isError: true };
        }
      }

      // G4.6: generate_plan tool (advisory only, does NOT create child tasks)
      case 'generate_plan': {
        const task = String(args.task ?? '');
        const constraints = typeof args.constraints === 'string' ? args.constraints : undefined;

        if (!task) {
          return { content: 'task is required', isError: true };
        }

        // Build context for plan generation
        const children = await this.handler.listChildren();
        const contextParts = [
          `Task: ${task}`,
          constraints ? `Constraints: ${constraints}` : '',
          children.length > 0
            ? `Active sessions: ${children.map((c) => `${c.title}(${c.status})`).join(', ')}`
            : '',
        ].filter(Boolean);

        // Return structured prompt — the LLM will fill in the plan
        return {
          instruction: 'Based on the context below, generate a structured execution plan.',
          context: contextParts.join('\n'),
          output_format: {
            phases: [
              {
                title: 'string: phase name',
                description: 'string: what this phase does',
                agent_role: 'string: suggested role (Architect/Developer/Evaluator/etc)',
                dependencies: 'string[]: phase titles this depends on',
                estimated_effort: 'string: S/M/L',
              },
            ],
            parallel_groups: 'number[][]: indices of phases that can run in parallel',
            estimated_total: 'string: overall effort estimate',
          },
        };
      }

      // G4.7: save_memory tool (admin only)
      case 'save_memory': {
        const type = String(args.type ?? '');
        const title = String(args.title ?? '');
        const content = String(args.content ?? '');

        if (!type || !title || !content) {
          return { content: 'type, title, and content are required', isError: true };
        }

        const validTypes = ['user', 'feedback', 'project', 'reference'];
        if (!validTypes.includes(type)) {
          return {
            content: `Invalid type "${type}". Must be one of: ${validTypes.join(', ')}`,
            isError: true,
          };
        }

        try {
          const result = await this.handler.saveMemory({ type, title, content });
          return { message: result };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { content: `Failed to save memory: ${errMsg}`, isError: true };
        }
      }

      // Gap-3: send_user_message — channel isolation, user-facing output
      case 'send_user_message': {
        const message = String(args.message ?? '');
        if (!message) {
          return { content: 'message is required', isError: true };
        }
        if (!this.handler.sendUserMessage) {
          return { content: 'send_user_message not supported', isError: true };
        }
        try {
          const result = await this.handler.sendUserMessage(message);
          return { message: result };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          return { content: `Failed to send message: ${errMsg}`, isError: true };
        }
      }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  /**
   * Get MCP server configuration for the admin agent CLI.
   * Returns the command/args to start the inline MCP server script.
   *
   * @param socketPath - Unix domain socket path for IPC with the main process.
   *   When provided, the MCP script connects to this socket for bidirectional
   *   tool_call/tool_result communication. This is the primary (and only reliable)
   *   IPC mechanism, since the MCP SDK spawns the script via child_process.spawn()
   *   which does NOT create a Node.js IPC channel.
   */
  getMcpServerConfig(socketPath?: string): { command: string; args: string[]; env: Record<string, string> } {
    const env: Record<string, string> = {};
    if (socketPath) {
      env.AIONUI_DISPATCH_SOCKET = socketPath;
    }
    return {
      command: process.execPath,
      args: [path.resolve(__dirname, 'dispatchMcpServerScript.js'), this.handler.parentSessionId],
      env,
    };
  }

  /**
   * Get the tool schemas for MCP registration.
   *
   * IMPORTANT: Keep in sync with TOOL_SCHEMAS in dispatchMcpServerScript.ts.
   * When adding or modifying dispatch tools, update BOTH locations.
   */
  static getToolSchemas(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return [
      {
        name: 'start_task',
        description:
          'Start a new child task. Creates an independent agent session that executes the given prompt. ' +
          'Returns a session_id for tracking. Maximum concurrent tasks per session constraints.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed instructions for the child agent. Be specific and self-contained.',
            },
            title: {
              type: 'string',
              description: 'Short label for the task (3-6 words), shown in the UI status card.',
            },
            teammate: {
              type: 'object',
              description: 'Optional teammate configuration for the child agent.',
              properties: {
                name: { type: 'string', description: 'Display name for the teammate' },
                avatar: { type: 'string', description: 'Avatar emoji or URL' },
                presetRules: {
                  type: 'string',
                  description: 'System instructions for the child agent',
                },
              },
            },
            model: {
              type: 'object',
              description: 'Optional model override for this child agent. Omit to use the default dispatcher model.',
              properties: {
                provider_id: {
                  type: 'string',
                  description: 'Provider ID from the configured model list',
                },
                model_name: {
                  type: 'string',
                  description: 'Model name (e.g., "gemini-2.5-pro", "gemini-2.0-flash")',
                },
              },
              required: ['provider_id', 'model_name'],
            },
            workspace: {
              type: 'string',
              description:
                'Optional working directory for the child agent. Must be an existing directory. Omit to inherit parent workspace.',
            },
            agent_type: {
              type: 'string',
              description:
                'Engine type for the child agent. Options: gemini, acp, codex, openclaw-gateway, nanobot, remote. ' +
                'Defaults to gemini if omitted.',
              enum: ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote'],
            },
            member_id: {
              type: 'string',
              description: 'Reference an existing group member by ID. Auto-fills config from their profile.',
            },
            isolation: {
              type: 'string',
              description: 'Isolation mode for the child workspace. Currently only "worktree" is planned (G2).',
              enum: ['worktree'],
            },
            allowed_tools: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional allowlist of tool names this child can use (e.g., ["Read", "Edit", "Bash"]). ' +
                'Omit to allow all tools. Safe tools (Read, Grep, Glob) are always allowed.',
            },
          },
          required: ['prompt', 'title'],
        },
      },
      // Gap-5: start_code_task — code-specific task with worktree isolation
      {
        name: 'start_code_task',
        description:
          'Start a child task for code work with automatic git worktree isolation. ' +
          'The child gets its own branch and working copy, preventing conflicts with other tasks. ' +
          'Use this instead of start_task when the task involves writing or modifying code.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed instructions for the child agent. Be specific and self-contained.',
            },
            title: {
              type: 'string',
              description: 'Short label for the task (3-6 words).',
            },
            workspace: {
              type: 'string',
              description: 'Working directory for the code task. Defaults to parent workspace.',
            },
            agent_type: {
              type: 'string',
              description: 'Engine type for the child agent.',
              enum: ['gemini', 'acp', 'codex', 'openclaw-gateway', 'nanobot', 'remote'],
            },
            member_id: {
              type: 'string',
              description: 'Reference an existing group member by ID.',
            },
            teammate: {
              type: 'object',
              description: 'Optional teammate configuration.',
              properties: {
                name: { type: 'string', description: 'Display name' },
                avatar: { type: 'string', description: 'Avatar emoji or URL' },
                presetRules: { type: 'string', description: 'System instructions' },
              },
            },
          },
          required: ['prompt', 'title'],
        },
      },
      {
        name: 'read_transcript',
        description:
          'Read the conversation transcript of a child task. ' +
          'If the task is still running, waits up to max_wait_seconds for completion. ' +
          'Returns formatted [user]/[assistant] conversation text with tool call summaries.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'The session ID returned by start_task.',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to return. Default 20.',
            },
            max_wait_seconds: {
              type: 'number',
              description: 'Seconds to wait for task completion. Default 30. Use 0 for immediate return.',
            },
            format: {
              type: 'string',
              enum: ['auto', 'full'],
              description:
                'Output format. "auto" returns summary when running, full when done. "full" always returns full transcript.',
            },
          },
          required: ['session_id'],
        },
      },
      // F-2.2: list_sessions replaces list_children
      {
        name: 'list_sessions',
        description:
          'List all child sessions spawned by this dispatcher. ' +
          'Shows session ID, title, status (running/idle/cancelled/failed), and last activity time. ' +
          'Sorted by most recent activity first. Use session IDs with read_transcript or send_message.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max sessions to return (default 20, most recent first)',
            },
          },
          required: [],
        },
      },
      // F-2.1: send_message tool
      {
        name: 'send_message',
        description:
          'Send a follow-up message to a child task. ' +
          'Works on running and idle tasks. Idle tasks will be automatically resumed. ' +
          'For new work, use start_task instead. ' +
          'Returns confirmation; use read_transcript to see the response.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'session_id from start_task or list_sessions',
            },
            message: {
              type: 'string',
              description: 'The follow-up user message to send',
            },
          },
          required: ['session_id', 'message'],
        },
      },
      // G2.3: stop_child tool
      {
        name: 'stop_child',
        description:
          'Stop a running child task and clean up its resources (including worktree if any). ' +
          'The child process is killed immediately. Use read_transcript to see partial results.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'The session_id of the child task to stop.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for stopping (logged and included in notification).',
            },
          },
          required: ['session_id'],
        },
      },
      // G2.4: ask_user tool
      {
        name: 'ask_user',
        description:
          'Ask the user a question when you cannot make a decision autonomously. ' +
          'The question is relayed to the group chat via the admin. ' +
          'Returns the user response when available, or a timeout message. ' +
          'Use sparingly -- only for critical decisions that require human judgment.',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'The question to ask the user. Be specific and provide context.',
            },
            context: {
              type: 'string',
              description: 'Optional additional context about why you need this answer.',
            },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of suggested answers for the user to choose from.',
            },
          },
          required: ['question'],
        },
      },
      // G4.6: generate_plan tool
      {
        name: 'generate_plan',
        description:
          'Generate a structured execution plan before delegating tasks. ' +
          'Does NOT start any tasks. Returns a plan with phases, dependencies, and estimates. ' +
          'Use this for complex multi-step requests before calling start_task.',
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The high-level task description from the user.',
            },
            constraints: {
              type: 'string',
              description: 'Optional constraints (time, cost, quality priorities).',
            },
          },
          required: ['task'],
        },
      },
      // Gap-3: send_user_message tool (channel isolation)
      {
        name: 'send_user_message',
        description:
          'Send a message to the user in the group chat. ' +
          'This is the ONLY way to communicate with the user when channel isolation is enabled. ' +
          'Your plain text replies are internal reasoning and NOT shown to the user.',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'The message to display to the user in the group chat.',
            },
          },
          required: ['message'],
        },
      },
      // G4.7: save_memory tool
      {
        name: 'save_memory',
        description:
          'Save an important piece of information to persistent memory. ' +
          'Memories persist across sessions and are auto-loaded in future conversations. ' +
          'Use for: user preferences, project decisions, feedback, important references.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['user', 'feedback', 'project', 'reference'],
              description: 'Memory category.',
            },
            title: {
              type: 'string',
              description: 'Short title for this memory entry (used in MEMORY.md index).',
            },
            content: {
              type: 'string',
              description: 'The memory content to save.',
            },
          },
          required: ['type', 'title', 'content'],
        },
      },
    ];
  }

  /**
   * Dispose the MCP server and release resources.
   */
  dispose(): void {
    this.disposed = true;
    mainLog('[DispatchMcpServer]', `Disposed for session: ${this.handler.parentSessionId}`);
  }
}
