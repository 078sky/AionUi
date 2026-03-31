/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import { groupRoom } from '@/common/adapter/ipcBridge';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { AcpBackend, AcpBackendAll } from '@/common/types/acpTypes';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import type { IConversationService } from '@process/services/IConversationService';
import type { IAgentFactory } from '@process/task/IAgentFactory';
import type { AgentType } from '@process/task/agentTypes';
import { AcpAgent } from '@process/agent/acp';
import { GroupRoomService } from '@process/services/groupRoom/GroupRoomService';
import type { IGroupMember } from '@process/services/groupRoom/groupRoomTypes';
import { DispatchMcpServer, type DispatchToolCall } from '@process/services/groupRoom/dispatchMcpServer';
import { formatResultReport, type SubAgentResult } from '@process/services/groupRoom/dispatchParser';
import { uuid } from '@/common/utils';

type GroupRoomThoughtData = {
  subject: string;
  description: string;
};

/**
 * Orchestrates multi-agent Group Room sessions via MCP tool protocol.
 *
 * Architecture (mirrors Claude Code's Agent tool 1:1):
 *   1. Start an HTTP MCP server exposing `GroupDispatch` tool
 *   2. Inject MCP server into host AcpAgent's session
 *   3. Host agent calls GroupDispatch via standard tool_use
 *   4. MCP handler creates sub-AcpAgent, runs task, returns tool_result
 *   5. Host agent receives result and decides next action naturally
 *
 * No manual loop, no XML parsing — the model controls the dispatch cycle
 * exactly as Claude Code's built-in Agent tool does.
 */
export class GroupRoomOrchestrator {
  private readonly service: GroupRoomService;
  private readonly agentInstances = new Map<string, AcpAgent>();
  private readonly mcpServer = new DispatchMcpServer();
  private turnCompleted = false;
  private tornDown = false;

  constructor(
    private readonly roomId: string,
    private readonly db: ISqliteDriver,
    private readonly conversationService: IConversationService,
    private readonly agentFactory: IAgentFactory
  ) {
    this.service = new GroupRoomService(db);
  }

  // ================================================================
  // Public API
  // ================================================================

  /**
   * Start the orchestration: spin up MCP server, create host agent with
   * GroupDispatch tool injected, send user message, wait for completion.
   *
   * The host agent drives the dispatch cycle autonomously via tool_use —
   * no manual loop or text parsing needed.
   */
  async start(userInput: string, userMsgId: string): Promise<void> {
    const roomData = this.service.getRoom(this.roomId);
    if (!roomData) {
      throw new Error(`[GroupRoomOrchestrator] Room not found: ${this.roomId}`);
    }

    const { room, members } = roomData;

    this.service.updateRoomStatus(this.roomId, 'running');

    // Resolve host conversation config
    const hostConv = await this.conversationService.getConversation(room.hostConversationId);
    const hostExtra = (hostConv?.extra ?? {}) as Record<string, unknown>;
    const workspace = typeof hostExtra['workspace'] === 'string' ? hostExtra['workspace'] : os.homedir();
    const backend =
      typeof hostExtra['backend'] === 'string' ? (hostExtra['backend'] as AcpBackend) : ('claude' as AcpBackend);
    const cliPath = typeof hostExtra['cliPath'] === 'string' ? hostExtra['cliPath'] : undefined;
    const acpSessionId = typeof hostExtra['acpSessionId'] === 'string' ? hostExtra['acpSessionId'] : undefined;
    const acpSessionConversationId =
      typeof hostExtra['acpSessionConversationId'] === 'string' ? hostExtra['acpSessionConversationId'] : undefined;
    const currentModelId = typeof hostExtra['currentModelId'] === 'string' ? hostExtra['currentModelId'] : undefined;
    const sessionMode = typeof hostExtra['sessionMode'] === 'string' ? hostExtra['sessionMode'] : undefined;
    const agentName = typeof hostExtra['agentName'] === 'string' ? hostExtra['agentName'] : undefined;

    const hostMember = members.find((m) => m.role === 'host');
    const hostAgentRowId = hostMember?.id ?? room.hostConversationId;
    const hostDisplayName = hostMember?.displayName ?? 'Host';

    // ── Start MCP server with GroupDispatch tool ──
    // The handler is called each time the host agent invokes GroupDispatch via tool_use.
    // It runs the sub-agent and returns the output as tool_result content.
    await this.mcpServer.start(members, async (call: DispatchToolCall) => {
      if (this.tornDown) return 'Orchestrator has been torn down.';

      const result = await this.handleDispatchCall(call, workspace, {
        cliPath,
        currentModelId,
        sessionMode,
        hostDisplayName,
      });

      // Persist dispatch record
      this.service.addMessage({
        roomId: this.roomId,
        senderType: 'agent',
        senderId: hostAgentRowId,
        msgKind: 'host_dispatch',
        content: `[${call.description}] ${call.prompt}`,
        status: 'finish',
      });
      groupRoom.responseStream.emit({
        roomId: this.roomId,
        agentId: hostAgentRowId,
        agentRole: 'host',
        msg_kind: 'host_dispatch',
        content: `[${call.description}] ${call.prompt}`,
        msg_id: uuid(),
        status: 'finish',
        streaming: false,
        senderName: hostDisplayName,
        targetName: call.description,
      });

      return result;
    });

    // ── Host agent stream handling ──
    let hostResolve: ((content: string) => void) | null = null;
    let hostReject: ((err: Error) => void) | null = null;
    let hostAccumulated = '';
    let hostThoughtAccumulated = '';
    let hostThoughtMsgId = uuid();
    let hostEndTurnReceived = false;
    let endTurnTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleHostEvent = (data: IResponseMessage) => {
      const content = extractStreamText(data);

      if (data.type === 'content' && content) {
        if (hostThoughtAccumulated) {
          this.service.addMessage({
            roomId: this.roomId,
            senderType: 'agent',
            senderId: hostAgentRowId,
            msgKind: 'host_thought',
            content: hostThoughtAccumulated,
          });
          groupRoom.responseStream.emit({
            roomId: this.roomId,
            agentId: hostAgentRowId,
            agentRole: 'host',
            msg_kind: 'host_thought',
            content: '',
            msg_id: hostThoughtMsgId,
            streaming: false,
            senderName: hostDisplayName,
          });
          hostThoughtAccumulated = '';
          hostThoughtMsgId = uuid();
        }

        hostAccumulated += content;
        groupRoom.responseStream.emit({
          roomId: this.roomId,
          agentId: hostAgentRowId,
          agentRole: 'host',
          msg_kind: 'host_response',
          content,
          msg_id: data.msg_id,
          status: data.type,
          streaming: true,
          senderName: hostDisplayName,
        });
      }

      if (data.type === 'thought') {
        hostThoughtAccumulated += content;
        groupRoom.responseStream.emit({
          roomId: this.roomId,
          agentId: hostAgentRowId,
          agentRole: 'host',
          msg_kind: 'host_thought',
          content,
          msg_id: hostThoughtMsgId,
          status: data.type,
          streaming: true,
          senderName: hostDisplayName,
        });
      }

      if (data.type === 'error') {
        const errContent = content || 'Host agent encountered an error';
        hostReject?.(new Error(errContent));
        hostReject = null;
        hostResolve = null;
      }

      if (data.type === 'finish') {
        if (endTurnTimeoutId) {
          clearTimeout(endTurnTimeoutId);
          endTurnTimeoutId = null;
        }

        if (hostThoughtAccumulated) {
          this.service.addMessage({
            roomId: this.roomId,
            senderType: 'agent',
            senderId: hostAgentRowId,
            msgKind: 'host_thought',
            content: hostThoughtAccumulated,
          });
          groupRoom.responseStream.emit({
            roomId: this.roomId,
            agentId: hostAgentRowId,
            agentRole: 'host',
            msg_kind: 'host_thought',
            content: '',
            msg_id: hostThoughtMsgId,
            streaming: false,
            senderName: hostDisplayName,
          });
          hostThoughtAccumulated = '';
          hostThoughtMsgId = uuid();
        }

        const result = hostAccumulated;
        hostAccumulated = '';
        hostResolve?.(result);
        hostResolve = null;
        hostReject = null;
      }
    };

    const handleHostSignal = (data: IResponseMessage) => {
      if (data.type === 'finish') {
        hostEndTurnReceived = true;
        // Fallback: if stream never sends a finish event, resolve after 3s
        endTurnTimeoutId = setTimeout(() => {
          endTurnTimeoutId = null;
          if (hostResolve) {
            const result = hostAccumulated;
            hostAccumulated = '';
            hostResolve(result);
            hostResolve = null;
            hostReject = null;
          }
        }, 3000);
      }
      if (data.type === 'error') {
        const content = extractStreamText(data);
        const errContent = content || 'Host agent signal error';
        hostReject?.(new Error(errContent));
        hostReject = null;
        hostResolve = null;
      }
    };

    // ── Create host agent with MCP server injected ──
    const hostAgent = new AcpAgent({
      id: room.hostConversationId,
      backend,
      cliPath,
      workingDir: workspace,
      extra: {
        workspace,
        backend,
        cliPath,
        acpSessionId,
        acpSessionConversationId,
        currentModelId,
        sessionMode,
        agentName,
        yoloMode: true,
        // Inject our GroupDispatch MCP server into the host agent's session.
        // The AcpAgent passes this to session/new as a stdio MCP server.
        // Claude CLI spawns the stdio script which connects back to our TCP server.
        groupDispatchMcpServer: this.mcpServer.getStdioConfig(),
      },
      onStreamEvent: handleHostEvent,
      onSignalEvent: handleHostSignal,
    });

    this.agentInstances.set(hostAgentRowId, hostAgent);

    try {
      // Wrap user input with coordinator instructions so the host agent
      // knows to use GroupDispatch instead of answering directly.
      const coordinatorPrompt = buildCoordinatorPrompt(userInput, members);

      // Single send — the host agent will call GroupDispatch via tool_use
      // as many times as it needs. No manual loop required.
      const hostOutput = await new Promise<string>((resolve, reject) => {
        hostResolve = resolve;
        hostReject = reject;
        hostAccumulated = '';
        hostAgent.sendMessage({ content: coordinatorPrompt, msg_id: userMsgId }).catch(reject);
      });

      // Persist final host response
      if (hostOutput) {
        this.service.addMessage({
          roomId: this.roomId,
          senderType: 'agent',
          senderId: hostAgentRowId,
          msgKind: 'host_response',
          content: hostOutput,
          status: 'finish',
        });
      }

      this.emitTurnCompleted('finished');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      groupRoom.responseStream.emit({
        roomId: this.roomId,
        agentId: hostAgentRowId,
        agentRole: 'host',
        msg_kind: 'host_response',
        content: errMsg,
        msg_id: `err-${Date.now()}`,
        streaming: false,
        status: 'error',
        senderName: hostDisplayName,
      });
      this.emitTurnCompleted('error');
    }
  }

  /**
   * Kill all running agents, stop MCP server, mark room as paused. Idempotent.
   */
  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    const kills: Promise<void>[] = [];
    for (const agent of this.agentInstances.values()) {
      kills.push(agent.kill());
    }
    await Promise.allSettled(kills);
    this.agentInstances.clear();
    await this.mcpServer.stop();
    this.service.updateRoomStatus(this.roomId, 'paused');
  }

  // ================================================================
  // MCP tool handler
  // ================================================================

  /**
   * Handle a single GroupDispatch tool call from the host agent.
   * Matches an existing member or dynamically creates a sub-agent,
   * runs the task, and returns the output text.
   */
  private async handleDispatchCall(
    call: DispatchToolCall,
    workspace: string,
    hostConfig: { cliPath?: string; currentModelId?: string; sessionMode?: string; hostDisplayName: string }
  ): Promise<string> {
    let member: IGroupMember | undefined;

    // If subagent_type matches an existing member ID, reuse it
    if (call.subagent_type) {
      const roomData = this.service.getRoom(this.roomId);
      member = roomData?.members.find((m) => m.id === call.subagent_type || m.displayName === call.subagent_type);
    }

    // Otherwise, dynamically create a sub-agent
    if (!member) {
      member = await this.createDynamicSubAgent(call.subagent_type ?? 'claude', call.description, workspace);
    }

    // Mark member as running
    this.service.updateAgentStatus(member.id, 'running', call.prompt);
    groupRoom.memberChanged.emit({
      roomId: this.roomId,
      action: 'status_update',
      member: {
        id: member.id,
        displayName: member.displayName,
        role: member.role,
        agentType: member.agentType,
        status: 'running',
        currentTask: call.prompt,
      },
    });

    // Execute and return result
    const result = await this.executeOneSubAgent(member, call.prompt, workspace, hostConfig);
    return result.content;
  }

  // ================================================================
  // Sub-agent creation & execution (unchanged from original)
  // ================================================================

  private async createDynamicSubAgent(type: string, name: string, workspace: string): Promise<IGroupMember> {
    const agentType = mapAgentType(type);

    const conv = await this.conversationService.createConversation({
      type: agentType,
      name,
      model: { id: '', platform: '', name: '', baseUrl: '', apiKey: '', useModel: 'default' },
      extra: {
        workspace,
        backend: type as AcpBackendAll,
        groupRoomId: this.roomId,
        groupRoomSubAgent: true,
      },
    });

    const member = this.service.addAgent({
      roomId: this.roomId,
      role: 'sub',
      agentType: type,
      displayName: name,
      conversationId: conv.id,
    });

    groupRoom.memberChanged.emit({
      roomId: this.roomId,
      action: 'join',
      member: {
        id: member.id,
        displayName: member.displayName,
        role: 'sub',
        agentType: member.agentType,
        status: 'idle',
        currentTask: null,
      },
    });

    return member;
  }

  private executeOneSubAgent(
    member: IGroupMember,
    task: string,
    workspace: string,
    hostConfig: { cliPath?: string; currentModelId?: string; sessionMode?: string; hostDisplayName: string }
  ): Promise<SubAgentResult> {
    return new Promise<SubAgentResult>((resolve) => {
      let accumulated = '';
      let subThoughtAccumulated = '';
      let subThoughtMsgId = uuid();
      let subEndTurnReceived = false;
      let subEndTurnTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const conversationId = member.conversationId ?? uuid();
      const subBackend = resolveBackend(member);

      const flushSubThought = () => {
        if (!subThoughtAccumulated) return;
        this.service.addMessage({
          roomId: this.roomId,
          senderType: 'agent',
          senderId: member.id,
          msgKind: 'sub_thinking',
          content: subThoughtAccumulated,
        });
        groupRoom.responseStream.emit({
          roomId: this.roomId,
          agentId: member.id,
          agentRole: 'sub',
          msg_kind: 'sub_thinking',
          content: '',
          msg_id: subThoughtMsgId,
          streaming: false,
          senderName: member.displayName,
          targetName: hostConfig.hostDisplayName,
        });
        subThoughtAccumulated = '';
        subThoughtMsgId = uuid();
      };

      const handleSubEvent = (data: IResponseMessage) => {
        const content = extractStreamText(data);

        if (data.type === 'content' && content) {
          flushSubThought();
          accumulated += content;
          groupRoom.responseStream.emit({
            roomId: this.roomId,
            agentId: member.id,
            agentRole: 'sub',
            msg_kind: 'sub_output',
            content,
            msg_id: data.msg_id,
            status: data.type,
            streaming: true,
            senderName: member.displayName,
            targetName: hostConfig.hostDisplayName,
          });
        }

        if (data.type === 'thought') {
          subThoughtAccumulated += content;
          groupRoom.responseStream.emit({
            roomId: this.roomId,
            agentId: member.id,
            agentRole: 'sub',
            msg_kind: 'sub_thinking',
            content,
            msg_id: subThoughtMsgId,
            status: data.type,
            streaming: true,
            senderName: member.displayName,
            targetName: hostConfig.hostDisplayName,
          });
        }

        if (data.type === 'finish') {
          if (subEndTurnTimeoutId) {
            clearTimeout(subEndTurnTimeoutId);
            subEndTurnTimeoutId = null;
          }

          flushSubThought();
          this.service.addMessage({
            roomId: this.roomId,
            senderType: 'agent',
            senderId: member.id,
            msgKind: 'sub_output',
            content: accumulated,
            status: 'finish',
          });
          this.service.updateAgentStatus(member.id, 'finished', task);
          groupRoom.memberChanged.emit({
            roomId: this.roomId,
            action: 'status_update',
            member: {
              id: member.id,
              displayName: member.displayName,
              role: member.role,
              agentType: member.agentType,
              status: 'finished',
              currentTask: task,
            },
          });
          resolve({ agentName: member.displayName, status: 'success', content: accumulated });
        }

        if (data.type === 'error') {
          const errMsg = content || 'Sub-agent error';
          this.service.addMessage({
            roomId: this.roomId,
            senderType: 'agent',
            senderId: member.id,
            msgKind: 'sub_output',
            content: errMsg,
            status: 'error',
          });
          this.service.updateAgentStatus(member.id, 'error', task);
          groupRoom.memberChanged.emit({
            roomId: this.roomId,
            action: 'status_update',
            member: {
              id: member.id,
              displayName: member.displayName,
              role: member.role,
              agentType: member.agentType,
              status: 'error',
              currentTask: task,
            },
          });
          resolve({ agentName: member.displayName, status: 'error', content: errMsg });
        }
      };

      const resolveSubFinish = () => {
        flushSubThought();
        this.service.addMessage({
          roomId: this.roomId,
          senderType: 'agent',
          senderId: member.id,
          msgKind: 'sub_output',
          content: accumulated,
          status: 'finish',
        });
        this.service.updateAgentStatus(member.id, 'finished', task);
        groupRoom.memberChanged.emit({
          roomId: this.roomId,
          action: 'status_update',
          member: {
            id: member.id,
            displayName: member.displayName,
            role: member.role,
            agentType: member.agentType,
            status: 'finished',
            currentTask: task,
          },
        });
        resolve({ agentName: member.displayName, status: 'success', content: accumulated });
      };

      const handleSubSignal = (data: IResponseMessage) => {
        if (data.type === 'finish') {
          subEndTurnReceived = true;
          // Fallback: if stream never sends a finish event, resolve after 3s
          subEndTurnTimeoutId = setTimeout(() => {
            subEndTurnTimeoutId = null;
            resolveSubFinish();
          }, 3000);
        }
        if (data.type === 'error') {
          const content = extractStreamText(data);
          const errMsg = content || 'Sub-agent signal error';
          this.service.addMessage({
            roomId: this.roomId,
            senderType: 'agent',
            senderId: member.id,
            msgKind: 'sub_output',
            content: errMsg,
            status: 'error',
          });
          this.service.updateAgentStatus(member.id, 'error', task);
          groupRoom.memberChanged.emit({
            roomId: this.roomId,
            action: 'status_update',
            member: {
              id: member.id,
              displayName: member.displayName,
              role: member.role,
              agentType: member.agentType,
              status: 'error',
              currentTask: task,
            },
          });
          resolve({ agentName: member.displayName, status: 'error', content: errMsg });
        }
      };

      const subAgent = new AcpAgent({
        id: conversationId,
        backend: subBackend,
        cliPath: hostConfig.cliPath,
        workingDir: workspace,
        extra: {
          workspace,
          backend: subBackend,
          cliPath: hostConfig.cliPath,
          currentModelId: hostConfig.currentModelId,
          sessionMode: hostConfig.sessionMode,
          yoloMode: true,
        },
        onStreamEvent: handleSubEvent,
        onSignalEvent: handleSubSignal,
      });

      this.agentInstances.set(member.id, subAgent);

      subAgent.sendMessage({ content: task, msg_id: uuid() }).catch((err: unknown) => {
        resolve({
          agentName: member.displayName,
          status: 'error',
          content: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  // ================================================================
  // Internal helpers
  // ================================================================

  private emitTurnCompleted(status: 'finished' | 'error'): void {
    if (this.turnCompleted || this.tornDown) return;
    this.turnCompleted = true;
    this.service.updateRoomStatus(this.roomId, status === 'finished' ? 'idle' : 'error');
    groupRoom.turnCompleted.emit({
      roomId: this.roomId,
      status,
      canSendMessage: status === 'finished',
    });
  }
}

// ================================================================
// Module-level helpers
// ================================================================

/**
 * Build a coordinator prompt that wraps the user input with instructions
 * telling the host agent to use GroupDispatch for delegation.
 *
 * Without this, the host agent sees the raw user message and answers
 * it directly (or role-plays as multiple agents) instead of dispatching.
 */
function buildCoordinatorPrompt(userInput: string, members: IGroupMember[]): string {
  const subMembers = members.filter((m) => m.role === 'sub');

  const memberList = subMembers.map((m) => `- ${m.displayName} (type: ${m.agentType}, id: ${m.id})`).join('\n');

  const memberSection = memberList
    ? `\nAvailable team members:\n${memberList}\n`
    : '\nNo pre-configured team members. Use GroupDispatch to create new agents dynamically.\n';

  return [
    'You are a coordinator agent in a multi-agent group room.',
    "Your role is to break down the user's request and delegate tasks to specialized sub-agents using the GroupDispatch tool.",
    '',
    'IMPORTANT RULES:',
    '- You MUST use the GroupDispatch tool to delegate work to sub-agents. Do NOT try to do the work yourself.',
    '- Do NOT role-play as other agents or pretend to be multiple people.',
    '- For each sub-task, call GroupDispatch with a clear description and prompt.',
    '- You can launch multiple agents in parallel by making multiple GroupDispatch calls in a single response.',
    '- After all sub-agents complete, synthesize their results and provide a final summary to the user.',
    "- If a sub-agent's result is insufficient, you may dispatch follow-up tasks.",
    memberSection,
    '---',
    '',
    'User request:',
    userInput,
  ].join('\n');
}

function mapAgentType(type: string): AgentType {
  switch (type) {
    case 'claude':
      return 'acp';
    case 'gemini':
      return 'gemini';
    case 'codex':
      return 'codex';
    case 'remote':
      return 'remote';
    default:
      return 'acp';
  }
}

function resolveBackend(member: IGroupMember): AcpBackend {
  switch (member.agentType) {
    case 'claude':
      return 'claude';
    case 'gemini':
      return 'gemini-cli' as AcpBackend;
    case 'codex':
      return 'codex' as AcpBackend;
    default:
      return 'claude';
  }
}

function extractStreamText(data: IResponseMessage): string {
  if (typeof data.data === 'string') {
    return data.data;
  }

  if (data.type === 'thought') {
    const thought = extractThoughtData(data);
    if (thought) {
      return thought.description || thought.subject;
    }
  }

  return '';
}

function extractThoughtData(data: IResponseMessage): GroupRoomThoughtData | null {
  if (!data.data || typeof data.data !== 'object') {
    return null;
  }

  const thought = data.data as { subject?: unknown; description?: unknown };
  const subject = typeof thought.subject === 'string' ? thought.subject.trim() : '';
  const description = typeof thought.description === 'string' ? thought.description.trim() : '';

  if (!subject && !description) {
    return null;
  }

  return {
    subject,
    description,
  };
}
