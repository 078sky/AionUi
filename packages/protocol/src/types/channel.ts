/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Types only — runtime helper functions (rowToChannelUser, etc.)
// remain in src/process/channels/types.ts

// ==================== Plugin Types ====================

export type BuiltinPluginType = 'telegram' | 'slack' | 'discord' | 'lark' | 'dingtalk' | 'weixin';

export type PluginType = BuiltinPluginType | (string & {});

export type PluginStatus =
  | 'created'
  | 'initializing'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface IPluginCredentials {
  token?: string;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  clientId?: string;
  clientSecret?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface IPluginConfigOptions {
  mode?: 'polling' | 'webhook' | 'websocket';
  webhookUrl?: string;
  rateLimit?: number;
  requireMention?: boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface IChannelPluginConfig {
  id: string;
  type: PluginType;
  name: string;
  enabled: boolean;
  credentials?: IPluginCredentials;
  config?: IPluginConfigOptions;
  status: PluginStatus;
  lastConnected?: number;
  createdAt: number;
  updatedAt: number;
}

export interface IChannelPluginStatus {
  id: string;
  type: PluginType;
  name: string;
  enabled: boolean;
  connected: boolean;
  status: PluginStatus;
  lastConnected?: number;
  error?: string;
  activeUsers: number;
  botUsername?: string;
  hasToken?: boolean;
  isExtension?: boolean;
  extensionMeta?: {
    credentialFields?: Array<{
      key: string;
      label: string;
      type: 'text' | 'password' | 'select' | 'number' | 'boolean';
      required?: boolean;
      options?: string[];
      default?: string | number | boolean;
    }>;
    configFields?: Array<{
      key: string;
      label: string;
      type: 'text' | 'password' | 'select' | 'number' | 'boolean';
      required?: boolean;
      options?: string[];
      default?: string | number | boolean;
    }>;
    description?: string;
    extensionName?: string;
    icon?: string;
  };
}

// ==================== User Types ====================

export interface IChannelUser {
  id: string;
  platformUserId: string;
  platformType: PluginType;
  displayName?: string;
  authorizedAt: number;
  lastActive?: number;
  sessionId?: string;
}

export interface IChannelUserRow {
  id: string;
  platform_user_id: string;
  platform_type: string;
  display_name: string | null;
  authorized_at: number;
  last_active: number | null;
  session_id: string | null;
}

// ==================== Session Types ====================

export type ChannelAgentType = 'gemini' | 'acp' | 'codex' | 'openclaw-gateway';

export interface IChannelSession {
  id: string;
  userId: string;
  agentType: ChannelAgentType;
  conversationId?: string;
  workspace?: string;
  chatId?: string;
  createdAt: number;
  lastActivity: number;
}

export interface IChannelSessionRow {
  id: string;
  user_id: string;
  agent_type: string;
  conversation_id: string | null;
  workspace: string | null;
  chat_id: string | null;
  created_at: number;
  last_activity: number;
}

// ==================== Pairing Types ====================

export type PairingStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface IChannelPairingRequest {
  code: string;
  platformUserId: string;
  platformType: PluginType;
  displayName?: string;
  requestedAt: number;
  expiresAt: number;
  status: PairingStatus;
}

export interface IChannelPairingCodeRow {
  code: string;
  platform_user_id: string;
  platform_type: string;
  display_name: string | null;
  requested_at: number;
  expires_at: number;
  status: string;
}

// ==================== Message Types ====================

export type MessageContentType =
  | 'text'
  | 'photo'
  | 'document'
  | 'voice'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'action'
  | 'command';

export interface IUnifiedUser {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
}

export type AttachmentType = 'photo' | 'document' | 'voice' | 'audio' | 'video' | 'sticker';

export interface IUnifiedAttachment {
  type: AttachmentType;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  duration?: number;
}

export interface IUnifiedMessageContent {
  type: MessageContentType;
  text: string;
  attachments?: IUnifiedAttachment[];
}

export interface IMessageAction {
  type: ActionCategory;
  name: string;
  params?: Record<string, string>;
}

export interface IUnifiedIncomingMessage {
  id: string;
  platform: PluginType;
  chatId: string;
  user: IUnifiedUser;
  content: IUnifiedMessageContent;
  timestamp: number;
  replyToMessageId?: string;
  action?: IMessageAction;
  raw?: unknown;
}

export type MessageParseMode = 'plain' | 'markdown' | 'html';

export interface IActionButton {
  label: string;
  action: string;
  params?: Record<string, string>;
}

export interface IChannelMediaAction {
  type: 'image' | 'file';
  path: string;
  fileName?: string;
  caption?: string;
}

export interface IUnifiedOutgoingMessage {
  type: 'text' | 'image' | 'file' | 'buttons';
  text?: string;
  parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
  buttons?: IActionButton[][];
  keyboard?: IActionButton[][];
  replyMarkup?: unknown;
  imageUrl?: string;
  fileUrl?: string;
  fileName?: string;
  mediaActions?: IChannelMediaAction[];
  replyToMessageId?: string;
  silent?: boolean;
}

export interface BotInfo {
  id: string;
  username?: string;
  displayName: string;
}

// ==================== Action Types ====================

export type ActionCategory = 'platform' | 'system' | 'chat';

export interface IUnifiedAction {
  action: string;
  category: ActionCategory;
  params?: Record<string, string>;
  context: {
    platform: PluginType;
    userId: string;
    chatId: string;
    messageId?: string;
    sessionId?: string;
  };
}

export type ActionResponseBehavior = 'send' | 'edit' | 'answer';

export interface IActionResponse {
  text?: string;
  parseMode?: MessageParseMode;
  buttons?: IActionButton[][];
  keyboard?: IActionButton[][];
  behavior: ActionResponseBehavior;
  toast?: string;
  editMessageId?: string;
}

// ==================== Agent Response Types ====================

export type AgentResponseType = 'text' | 'stream_start' | 'stream_chunk' | 'stream_end' | 'error';

export interface IAgentResponse {
  type: AgentResponseType;
  text?: string;
  chunk?: string;
  error?: { code: string; message: string };
  metadata?: { model?: string; tokensUsed?: number; duration?: number };
  suggestedActions?: IActionButton[];
}

// ==================== Channel Platform Types ====================

export type ChannelPlatform = 'telegram' | 'lark' | 'dingtalk' | 'weixin' | (string & {});
