/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Agent Identity — unified abstraction for all agent types
 * Used by the Slack-like sidebar to group conversations by "person" (agent)
 */

import { ASSISTANT_PRESETS } from '@/common/config/presets/assistantPresets';
import type { TChatConversation } from '@/common/config/storage';

/** Employee type for agent personification */
export type AgentEmployeeType = 'permanent' | 'temporary';

/** Source of the agent identity */
export type AgentSource = 'preset' | 'custom' | 'dispatch_teammate' | 'cli_agent' | 'temporary_teammate';

/** Unified agent identity */
export type AgentIdentity = {
  id: string;
  name: string;
  avatar?: string;
  employeeType: AgentEmployeeType;
  source: AgentSource;
  backendType?: string;
  presetAgentType?: string;
  description?: string;
};

/**
 * Resolve agentId from a conversation's extra fields.
 *
 * Priority:
 *  1. extra.agentId (explicitly set on creation — new conversations)
 *  2. extra.customAgentId → "custom:{id}"
 *  3. extra.presetAssistantId → "preset:{id}"
 *  4. extra.backend (ACP backend key) → backend key as-is (e.g. "claude", "codex")
 *  5. conversation.type for non-ACP types → type as-is (e.g. "gemini")
 *  6. Fallback → "unknown"
 */
export function resolveAgentId(conversation: TChatConversation): string {
  const extra = conversation.extra as Record<string, unknown> | undefined;

  // 1. Explicit agentId (new conversations)
  if (extra?.agentId && typeof extra.agentId === 'string') {
    return extra.agentId;
  }

  // Skip dispatch child conversations — they shouldn't appear in sidebar
  if (extra?.dispatchSessionType === 'dispatch_child') {
    return 'dispatch_child';
  }

  // Dispatch conversations have their own Channel section
  if (conversation.type === 'dispatch') {
    return `dispatch:${conversation.id}`;
  }

  // 2. Custom agent
  if (extra?.customAgentId && typeof extra.customAgentId === 'string') {
    return `custom:${extra.customAgentId}`;
  }

  // 3. Preset assistant — strip "builtin-" prefix so IDs match registry keys (preset:word-creator)
  if (extra?.presetAssistantId && typeof extra.presetAssistantId === 'string') {
    const rawId = extra.presetAssistantId;
    const normalizedId = rawId.startsWith('builtin-') ? rawId.slice('builtin-'.length) : rawId;
    return `preset:${normalizedId}`;
  }

  // 4. ACP backend
  if (extra?.backend && typeof extra.backend === 'string') {
    return extra.backend;
  }

  // 5. Conversation type as fallback
  if (conversation.type) {
    return conversation.type;
  }

  return 'unknown';
}

/**
 * Get a display-friendly agent name from a conversation's extra fields.
 * Used when no AgentIdentity is available from the registry.
 */
export function resolveAgentDisplayName(conversation: TChatConversation): string {
  const extra = conversation.extra as Record<string, unknown> | undefined;

  if (extra?.agentDisplayName && typeof extra.agentDisplayName === 'string') {
    return extra.agentDisplayName;
  }

  if (extra?.agentName && typeof extra.agentName === 'string') {
    return extra.agentName;
  }

  // For dispatch
  if (extra?.groupChatName && typeof extra.groupChatName === 'string') {
    return extra.groupChatName;
  }

  // For preset assistants — look up the name from ASSISTANT_PRESETS so we don't fall back to "gemini"
  if (extra?.presetAssistantId && typeof extra.presetAssistantId === 'string') {
    const rawId = extra.presetAssistantId;
    const presetId = rawId.startsWith('builtin-') ? rawId.slice('builtin-'.length) : rawId;
    const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      return preset.nameI18n['en-US'] || preset.id;
    }
  }

  // Fallback to backend type
  if (extra?.backend && typeof extra.backend === 'string') {
    return extra.backend;
  }

  return conversation.type || 'Unknown';
}

/**
 * Get agent avatar from conversation's extra fields.
 */
export function resolveAgentAvatar(conversation: TChatConversation): string | undefined {
  const extra = conversation.extra as Record<string, unknown> | undefined;

  if (extra?.agentAvatar && typeof extra.agentAvatar === 'string') {
    return extra.agentAvatar;
  }

  const teammateConfig = extra?.teammateConfig as { avatar?: string } | undefined;
  if (teammateConfig?.avatar) {
    return teammateConfig.avatar;
  }

  // For preset assistants — return the preset emoji avatar so DM groups show correct icons
  if (extra?.presetAssistantId && typeof extra.presetAssistantId === 'string') {
    const rawId = extra.presetAssistantId;
    const presetId = rawId.startsWith('builtin-') ? rawId.slice('builtin-'.length) : rawId;
    const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
    if (preset?.avatar && !preset.avatar.endsWith('.svg')) {
      return preset.avatar;
    }
  }

  return undefined;
}
