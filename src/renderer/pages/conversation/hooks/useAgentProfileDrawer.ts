/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ASSISTANT_PRESETS } from '@/common/config/presets/assistantPresets';
import { ConfigStorage } from '@/common/config/storage';
import { resolveLocaleKey } from '@/common/utils';
import { useAgentRegistry } from '@renderer/hooks/useAgentRegistry';
import type { AgentIdentity } from '@renderer/utils/model/agentIdentity';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import type { AgentProfileDrawerData, GroupChatSummary } from '../components/AgentProfileDrawer/types';

type CustomAgentConfig = {
  id: string;
  name: string;
  avatar?: string;
  context?: string;
  enabledSkills?: string[];
  presetAgentType?: string;
};

/**
 * Hook that resolves agent profile data for the AgentProfileDrawer.
 * Looks up the agent identity from the registry, then resolves
 * assistant-specific data (rule, skills, mounted agents) based on source type.
 */
export function useAgentProfileDrawer(agentId: string): AgentProfileDrawerData | null {
  const registry = useAgentRegistry();
  const identity = registry.get(agentId);
  const { i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n.language);

  const isPreset = agentId.startsWith('preset:');
  const isCustom = agentId.startsWith('custom:');
  const customId = isCustom ? agentId.slice('custom:'.length) : null;

  // Fetch preset assistant rule via IPC (cached with SWR)
  const presetAssistantId = isPreset ? `builtin-${agentId.replace('preset:', '')}` : null;
  const { data: presetRule } = useSWR<string>(
    presetAssistantId ? `assistant-rule:${presetAssistantId}:${localeKey}` : null,
    () =>
      ipcBridge.fs.readAssistantRule.invoke({
        assistantId: presetAssistantId!,
        locale: localeKey,
      }),
    { revalidateOnFocus: false }
  );

  // Fetch custom agents config for custom agent rule/skills
  const { data: customAgents } = useSWR<CustomAgentConfig[]>(
    isCustom ? 'acp.customAgents' : null,
    () => ConfigStorage.get('acp.customAgents') as Promise<CustomAgentConfig[]>,
    { revalidateOnFocus: false }
  );

  return useMemo(() => {
    if (!identity) return null;

    let rule: string | undefined;
    let skills: string[] = [];
    let mountedAgents: AgentIdentity[] = [];
    const groupChats: GroupChatSummary[] = [];

    if (identity.employeeType === 'permanent') {
      if (identity.source === 'preset') {
        // Preset assistant: resolve from ASSISTANT_PRESETS
        const presetId = agentId.replace('preset:', '');
        const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          skills = preset.defaultEnabledSkills ?? [];

          // Resolve mounted agent from presetAgentType
          if (preset.presetAgentType) {
            const mountedIdentity = registry.get(preset.presetAgentType);
            if (mountedIdentity) {
              mountedAgents = [mountedIdentity];
            }
          }
        }
        rule = presetRule || undefined;
      } else if (isCustom && customAgents) {
        // Custom agent: resolve from config
        const customConfig = customAgents.find((a) => a.id === customId);
        if (customConfig) {
          rule = customConfig.context;
          skills = customConfig.enabledSkills ?? [];

          if (customConfig.presetAgentType) {
            const mountedIdentity = registry.get(customConfig.presetAgentType);
            if (mountedIdentity) {
              mountedAgents = [mountedIdentity];
            }
          }
        }
      }
    }

    return {
      identity,
      rule,
      skills,
      mountedAgents,
      groupChats,
    };
  }, [identity, agentId, isPreset, isCustom, customId, presetRule, customAgents, registry]);
}
