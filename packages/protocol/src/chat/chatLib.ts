/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Types only — runtime functions (joinPath, transformMessage, composeMessage)
// remain in src/common/chat/chatLib.ts

import type { CodexPermissionRequest } from '@/common/types/codex/types';
import type {
  ExecCommandBeginData,
  ExecCommandEndData,
  ExecCommandOutputDeltaData,
  McpToolCallBeginData,
  McpToolCallEndData,
  PatchApplyBeginData,
  PatchApplyEndData,
  TurnDiffData,
  WebSearchBeginData,
  WebSearchEndData,
} from '@/common/types/codex/types/eventData';
import type { AcpBackend, AcpPermissionRequest, PlanUpdate, ToolCallUpdate } from '../types/acpTypes';

type TMessageType =
  | 'text'
  | 'tips'
  | 'tool_call'
  | 'tool_group'
  | 'agent_status'
  | 'acp_permission'
  | 'acp_tool_call'
  | 'codex_permission'
  | 'codex_tool_call'
  | 'plan'
  | 'thinking'
  | 'available_commands';

interface IMessage<T extends TMessageType, Content extends Record<string, any>> {
  id: string;
  msg_id?: string;
  conversation_id: string;
  type: T;
  content: Content;
  createdAt?: number;
  position?: 'left' | 'right' | 'center' | 'pop';
  status?: 'finish' | 'pending' | 'error' | 'work';
}

export type CronMessageMeta = {
  source: 'cron';
  cronJobId: string;
  cronJobName: string;
  triggeredAt: number;
};

export type IMessageText = IMessage<'text', { content: string; cronMeta?: CronMessageMeta }>;

export type IMessageTips = IMessage<'tips', { content: string; type: 'error' | 'success' | 'warning' }>;

export type IMessageToolCall = IMessage<
  'tool_call',
  {
    callId: string;
    name: string;
    args: Record<string, any>;
    error?: string;
    status?: 'success' | 'error';
  }
>;

type IMessageToolGroupConfirmationDetailsBase<Type, Extra extends Record<string, any>> = {
  type: Type;
  title: string;
} & Extra;

export type IMessageToolGroup = IMessage<
  'tool_group',
  Array<{
    callId: string;
    description: string;
    name: string;
    renderOutputAsMarkdown: boolean;
    resultDisplay?:
      | string
      | { fileDiff: string; fileName: string }
      | { img_url: string; relative_path: string };
    status: 'Executing' | 'Success' | 'Error' | 'Canceled' | 'Pending' | 'Confirming';
    confirmationDetails?:
      | IMessageToolGroupConfirmationDetailsBase<'edit', { fileName: string; fileDiff: string; isModifying?: boolean }>
      | IMessageToolGroupConfirmationDetailsBase<'exec', { rootCommand: string; command: string }>
      | IMessageToolGroupConfirmationDetailsBase<'info', { urls?: string[]; prompt: string }>
      | IMessageToolGroupConfirmationDetailsBase<
          'mcp',
          { toolName: string; toolDisplayName: string; serverName: string }
        >;
  }>
>;

export type IMessageAgentStatus = IMessage<
  'agent_status',
  {
    backend: AcpBackend;
    status: 'connecting' | 'connected' | 'authenticated' | 'session_active' | 'disconnected' | 'error';
    agentName?: string;
    sessionId?: string;
    isConnected?: boolean;
    hasActiveSession?: boolean;
  }
>;

export type IMessageAcpPermission = IMessage<'acp_permission', AcpPermissionRequest>;

export type IMessageAcpToolCall = IMessage<'acp_tool_call', ToolCallUpdate>;

export type IMessageCodexPermission = IMessage<'codex_permission', CodexPermissionRequest>;

interface BaseCodexToolCallUpdate {
  toolCallId: string;
  status: 'pending' | 'executing' | 'success' | 'error' | 'canceled';
  title?: string;
  kind: 'execute' | 'patch' | 'mcp' | 'web_search';
  description?: string;
  content?: Array<{
    type: 'text' | 'diff' | 'output';
    text?: string;
    output?: string;
    filePath?: string;
    oldText?: string;
    newText?: string;
  }>;
  startTime?: number;
  endTime?: number;
}

export type CodexToolCallUpdate =
  | (BaseCodexToolCallUpdate & { subtype: 'exec_command_begin'; data: ExecCommandBeginData })
  | (BaseCodexToolCallUpdate & { subtype: 'exec_command_output_delta'; data: ExecCommandOutputDeltaData })
  | (BaseCodexToolCallUpdate & { subtype: 'exec_command_end'; data: ExecCommandEndData })
  | (BaseCodexToolCallUpdate & { subtype: 'patch_apply_begin'; data: PatchApplyBeginData })
  | (BaseCodexToolCallUpdate & { subtype: 'patch_apply_end'; data: PatchApplyEndData })
  | (BaseCodexToolCallUpdate & { subtype: 'mcp_tool_call_begin'; data: McpToolCallBeginData })
  | (BaseCodexToolCallUpdate & { subtype: 'mcp_tool_call_end'; data: McpToolCallEndData })
  | (BaseCodexToolCallUpdate & { subtype: 'web_search_begin'; data: WebSearchBeginData })
  | (BaseCodexToolCallUpdate & { subtype: 'web_search_end'; data: WebSearchEndData })
  | (BaseCodexToolCallUpdate & { subtype: 'turn_diff'; data: TurnDiffData })
  | (BaseCodexToolCallUpdate & { subtype: 'generic'; data?: any });

export type IMessageCodexToolCall = IMessage<'codex_tool_call', CodexToolCallUpdate>;

export type IMessagePlan = IMessage<
  'plan',
  {
    sessionId: string;
    entries: PlanUpdate['update']['entries'];
  }
>;

export type IMessageThinking = IMessage<
  'thinking',
  {
    content: string;
    subject?: string;
    duration?: number;
    status: 'thinking' | 'done';
  }
>;

export type AvailableCommand = {
  name: string;
  description: string;
  hint?: string;
};

export type IMessageAvailableCommands = IMessage<'available_commands', { commands: AvailableCommand[] }>;

export type TMessage =
  | IMessageText
  | IMessageTips
  | IMessageToolCall
  | IMessageToolGroup
  | IMessageAgentStatus
  | IMessageAcpPermission
  | IMessageAcpToolCall
  | IMessageCodexPermission
  | IMessageCodexToolCall
  | IMessagePlan
  | IMessageThinking
  | IMessageAvailableCommands;

export interface IConfirmation<Option extends any = any> {
  title?: string;
  id: string;
  action?: string;
  description: string;
  callId: string;
  options: Array<{
    label: string;
    value: Option;
    params?: Record<string, string>;
  }>;
  commandType?: string;
}
