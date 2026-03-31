/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type GroupMemberRole = 'host' | 'sub';
export type GroupMemberStatus = 'idle' | 'running' | 'finished' | 'error';

export type GroupMember = {
  id: string;
  displayName: string;
  agentType: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  currentTask: string | null;
};

export type GroupRoomInfo = {
  id: string;
  name: string;
  description: string | null;
  status: 'idle' | 'running' | 'paused' | 'finished' | 'error';
};

export type GroupMessage = {
  id: string;
  msgKind:
    | 'user_input'
    | 'host_response'
    | 'host_thought'
    | 'host_dispatch'
    | 'result_injection'
    | 'sub_thinking'
    | 'sub_output'
    | 'sub_status'
    | 'system'
    | 'agent_join';
  senderId: string | null;
  senderName: string | null;
  targetId: string | null;
  targetName: string | null;
  senderRole: GroupMemberRole | null;
  content: string;
  streaming: boolean;
  createdAt: number;
};
