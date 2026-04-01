// Conversation endpoint types - extracted from ipcBridge.ts

import type { TProviderWithModel } from '@/common/config/storage'
import type { AcpBackendAll } from '@/common/types/acpTypes'

export type ISendMessageParams = {
  input: string
  msg_id: string
  conversation_id: string
  files?: string[]
  loading_id?: string
  /** Skill names to inject into the message (used by agents with file-reading ability) */
  injectSkills?: string[]
}

export type IConfirmMessageParams = {
  confirmKey: string
  msg_id: string
  conversation_id: string
  callId: string
}

export type ICreateConversationParams = {
  type: 'gemini' | 'acp' | 'codex' | 'openclaw-gateway' | 'nanobot' | 'remote'
  id?: string
  name?: string
  model: TProviderWithModel
  extra: {
    workspace?: string
    customWorkspace?: boolean
    defaultFiles?: string[]
    backend?: AcpBackendAll
    cliPath?: string
    webSearchEngine?: 'google' | 'default'
    agentName?: string
    customAgentId?: string
    context?: string
    contextFileName?: string
    presetRules?: string
    enabledSkills?: string[]
    presetContext?: string
    presetAssistantId?: string
    sessionMode?: string
    codexModel?: string
    currentModelId?: string
    runtimeValidation?: {
      expectedWorkspace?: string
      expectedBackend?: string
      expectedAgentName?: string
      expectedCliPath?: string
      expectedModel?: string
      expectedIdentityHash?: string | null
      switchedAt?: number
    }
    isHealthCheck?: boolean
    remoteAgentId?: string
  }
}

export type IResetConversationParams = {
  id?: string
  gemini?: {
    clearCachedCredentialFile?: boolean
  }
}

export type IResponseMessage = {
  type: string
  data: unknown
  msg_id: string
  conversation_id: string
}

export type IConversationTurnCompletedEvent = {
  sessionId: string
  status: 'pending' | 'running' | 'finished'
  state:
    | 'ai_generating'
    | 'ai_waiting_input'
    | 'ai_waiting_confirmation'
    | 'initializing'
    | 'stopped'
    | 'error'
    | 'unknown'
  detail: string
  canSendMessage: boolean
  runtime: {
    hasTask: boolean
    taskStatus?: 'pending' | 'running' | 'finished'
    isProcessing: boolean
    pendingConfirmations: number
    dbStatus?: 'pending' | 'running' | 'finished'
  }
  workspace: string
  model: {
    platform: string
    name: string
    useModel: string
  }
  lastMessage: {
    id?: string
    type?: string
    content: unknown
    status?: string | null
    createdAt: number
  }
}

export type IConversationListChangedEvent = {
  conversationId: string
  action: 'created' | 'updated' | 'deleted'
  source?: string
}

export type ConversationSideQuestionResult =
  | { status: 'ok'; answer: string }
  | { status: 'noAnswer' }
  | { status: 'unsupported' }
  | { status: 'invalid'; reason: 'emptyQuestion' }
  | { status: 'toolsRequired' }
