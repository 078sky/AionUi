/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Types only — storage instances (ChatStorage, ConfigStorage, etc.)
// remain in src/common/config/storage.ts

import type { AcpBackend, AcpBackendAll, AcpBackendConfig } from '../types/acpTypes';
import type { SpeechToTextConfig } from '../types/speech';
import type { AcpModelInfo } from '../types/acpTypes';

export interface IConfigStorageRefer {
  'gemini.config': {
    authType: string;
    proxy: string;
    GOOGLE_GEMINI_BASE_URL?: string;
    /** @deprecated Use accountProjects instead. Kept for backward compatibility migration. */
    GOOGLE_CLOUD_PROJECT?: string;
    accountProjects?: Record<string, string>;
    yoloMode?: boolean;
    preferredMode?: string;
  };
  'codex.config'?: {
    cliPath?: string;
    yoloMode?: boolean;
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  };
  'acp.config': {
    [backend in AcpBackend]?: {
      authMethodId?: string;
      authToken?: string;
      lastAuthTime?: number;
      cliPath?: string;
      yoloMode?: boolean;
      preferredMode?: string;
      preferredModelId?: string;
      promptTimeout?: number;
    };
  };
  'acp.promptTimeout'?: number;
  'acp.customAgents'?: AcpBackendConfig[];
  'acp.cachedModels'?: Record<string, AcpModelInfo>;
  'model.config': IProvider[];
  'mcp.config': IMcpServer[];
  'mcp.agentInstallStatus': Record<string, string[]>;
  language: string;
  theme: string;
  colorScheme: string;
  'ui.zoomFactor'?: number;
  'webui.desktop.enabled'?: boolean;
  'webui.desktop.allowRemote'?: boolean;
  'webui.desktop.port'?: number;
  customCss: string;
  'css.themes': ICssTheme[];
  'css.activeThemeId': string;
  'gemini.defaultModel': string | { id: string; useModel: string };
  'tools.imageGenerationModel': TProviderWithModel & {
    /** @deprecated Image generation is now controlled via built-in MCP server toggle */
    switch?: boolean;
  };
  'tools.speechToText'?: SpeechToTextConfig;
  'workspace.pasteConfirm'?: boolean;
  'guid.lastSelectedAgent'?: string;
  'migration.assistantEnabledFixed'?: boolean;
  /** @deprecated Use migration.builtinDefaultSkillsAdded_v2 instead */
  'migration.coworkDefaultSkillsAdded'?: boolean;
  'migration.builtinDefaultSkillsAdded_v2'?: boolean;
  'migration.promptsI18nAdded'?: boolean;
  'migration.electronConfigImported'?: boolean;
  'system.closeToTray'?: boolean;
  'system.notificationEnabled'?: boolean;
  'system.cronNotificationEnabled'?: boolean;
  'assistant.telegram.defaultModel'?: { id: string; useModel: string };
  'assistant.telegram.agent'?: { backend: AcpBackendAll; customAgentId?: string; name?: string };
  'assistant.lark.defaultModel'?: { id: string; useModel: string };
  'assistant.lark.agent'?: { backend: AcpBackendAll; customAgentId?: string; name?: string };
  'assistant.dingtalk.defaultModel'?: { id: string; useModel: string };
  'assistant.dingtalk.agent'?: { backend: AcpBackendAll; customAgentId?: string; name?: string };
  'assistant.weixin.defaultModel'?: { id: string; useModel: string };
  'assistant.weixin.agent'?: { backend: AcpBackendAll; customAgentId?: string; name?: string };
  'skillsMarket.enabled'?: boolean;
}

export interface IEnvStorageRefer {
  'aionui.dir': {
    workDir: string;
    cacheDir: string;
  };
}

export type ConversationSource = 'aionui' | 'telegram' | 'lark' | 'dingtalk' | 'weixin' | (string & {});

interface IChatConversation<T, Extra> {
  createTime: number;
  modifyTime: number;
  name: string;
  desc?: string;
  id: string;
  type: T;
  extra: Extra;
  model: TProviderWithModel;
  status?: 'pending' | 'running' | 'finished' | undefined;
  source?: ConversationSource;
  channelChatId?: string;
}

export interface TokenUsageData {
  totalTokens: number;
}

export type TChatConversation =
  | IChatConversation<
      'gemini',
      {
        workspace: string;
        customWorkspace?: boolean;
        webSearchEngine?: 'google' | 'default';
        lastTokenUsage?: TokenUsageData;
        contextFileName?: string;
        contextContent?: string;
        presetRules?: string;
        enabledSkills?: string[];
        presetAssistantId?: string;
        pinned?: boolean;
        pinnedAt?: number;
        sessionMode?: string;
        isHealthCheck?: boolean;
      }
    >
  | Omit<
      IChatConversation<
        'acp',
        {
          workspace?: string;
          backend: AcpBackend;
          cliPath?: string;
          customWorkspace?: boolean;
          agentName?: string;
          customAgentId?: string;
          presetContext?: string;
          enabledSkills?: string[];
          presetAssistantId?: string;
          pinned?: boolean;
          pinnedAt?: number;
          acpSessionId?: string;
          acpSessionConversationId?: string;
          acpSessionUpdatedAt?: number;
          lastTokenUsage?: TokenUsageData;
          lastContextLimit?: number;
          sessionMode?: string;
          currentModelId?: string;
          isHealthCheck?: boolean;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'codex',
        {
          workspace?: string;
          cliPath?: string;
          customWorkspace?: boolean;
          sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
          presetContext?: string;
          enabledSkills?: string[];
          presetAssistantId?: string;
          pinned?: boolean;
          pinnedAt?: number;
          sessionMode?: string;
          codexModel?: string;
          isHealthCheck?: boolean;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'openclaw-gateway',
        {
          workspace?: string;
          backend?: AcpBackendAll;
          agentName?: string;
          customWorkspace?: boolean;
          gateway?: {
            host?: string;
            port?: number;
            token?: string;
            password?: string;
            useExternalGateway?: boolean;
            cliPath?: string;
          };
          sessionKey?: string;
          runtimeValidation?: {
            expectedWorkspace?: string;
            expectedBackend?: string;
            expectedAgentName?: string;
            expectedCliPath?: string;
            expectedModel?: string;
            expectedIdentityHash?: string | null;
            switchedAt?: number;
          };
          enabledSkills?: string[];
          presetAssistantId?: string;
          pinned?: boolean;
          pinnedAt?: number;
          isHealthCheck?: boolean;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'nanobot',
        {
          workspace?: string;
          customWorkspace?: boolean;
          enabledSkills?: string[];
          presetAssistantId?: string;
          pinned?: boolean;
          pinnedAt?: number;
          isHealthCheck?: boolean;
        }
      >,
      'model'
    >
  | Omit<
      IChatConversation<
        'remote',
        {
          workspace?: string;
          customWorkspace?: boolean;
          remoteAgentId: string;
          sessionKey?: string;
          enabledSkills?: string[];
          presetAssistantId?: string;
          pinned?: boolean;
          pinnedAt?: number;
          isHealthCheck?: boolean;
        }
      >,
      'model'
    >;

export type IChatConversationRefer = {
  'chat.history': TChatConversation[];
};

export type ModelType =
  | 'text'
  | 'vision'
  | 'function_calling'
  | 'image_generation'
  | 'web_search'
  | 'reasoning'
  | 'embedding'
  | 'rerank'
  | 'excludeFromPrimary';

export type ModelCapability = {
  type: ModelType;
  isUserSelected?: boolean;
};

export interface IProvider {
  id: string;
  platform: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string[];
  capabilities?: ModelCapability[];
  contextLimit?: number;
  modelProtocols?: Record<string, string>;
  bedrockConfig?: {
    authMethod: 'accessKey' | 'profile';
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    profile?: string;
  };
  enabled?: boolean;
  modelEnabled?: Record<string, boolean>;
  modelHealth?: Record<
    string,
    {
      status: 'unknown' | 'healthy' | 'unhealthy';
      lastCheck?: number;
      latency?: number;
      error?: string;
    }
  >;
}

export type TProviderWithModel = Omit<IProvider, 'model'> & {
  useModel: string;
};

// MCP Server Configuration Types
export type McpTransportType = 'stdio' | 'sse' | 'http';

export interface IMcpServerTransportStdio {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface IMcpServerTransportSSE {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface IMcpServerTransportHTTP {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface IMcpServerTransportStreamableHTTP {
  type: 'streamable_http';
  url: string;
  headers?: Record<string, string>;
}

export type IMcpServerTransport =
  | IMcpServerTransportStdio
  | IMcpServerTransportSSE
  | IMcpServerTransportHTTP
  | IMcpServerTransportStreamableHTTP;

export interface IMcpServer {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  transport: IMcpServerTransport;
  tools?: IMcpTool[];
  status?: 'connected' | 'disconnected' | 'error' | 'testing';
  lastConnected?: number;
  createdAt: number;
  updatedAt: number;
  originalJson: string;
  builtin?: boolean;
}

export interface IMcpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ICssTheme {
  id: string;
  name: string;
  cover?: string;
  css: string;
  isPreset?: boolean;
  createdAt: number;
  updatedAt: number;
}
