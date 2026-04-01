/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useApi } from '@renderer/api';
import { ASSISTANT_PRESETS } from '@/common/config/presets/assistantPresets';
import type { AcpBackend, AcpBackendConfig } from '../types';
import { useCallback } from 'react';

type UsePresetAssistantResolverOptions = {
  customAgents: AcpBackendConfig[];
  localeKey: string;
};

type UsePresetAssistantResolverResult = {
  resolvePresetRulesAndSkills: (
    agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined
  ) => Promise<{ rules?: string; skills?: string }>;
  resolvePresetContext: (
    agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined
  ) => Promise<string | undefined>;
  resolvePresetAgentType: (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined) => string;
  resolveEnabledSkills: (
    agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined
  ) => string[] | undefined;
};

/**
 * Hook that provides preset assistant resolution callbacks.
 * Resolves rules, skills, context, and agent type for preset assistants.
 */
export const usePresetAssistantResolver = ({
  customAgents,
  localeKey,
}: UsePresetAssistantResolverOptions): UsePresetAssistantResolverResult => {
  const api = useApi();

  const resolvePresetRulesAndSkills = useCallback(
    async (
      agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined
    ): Promise<{ rules?: string; skills?: string }> => {
      if (!agentInfo) return {};
      if (agentInfo.backend !== 'custom') {
        return { rules: agentInfo.context };
      }

      const customAgentId = agentInfo.customAgentId;
      if (!customAgentId) return { rules: agentInfo.context };

      let rules = '';
      let skills = '';

      try {
        rules = await api.request('read-assistant-rule', {
          assistantId: customAgentId,
          locale: localeKey,
        });
      } catch (error) {
        console.warn(`Failed to load rules for ${customAgentId}:`, error);
      }

      try {
        skills = await api.request('read-assistant-skill', {
          assistantId: customAgentId,
          locale: localeKey,
        });
      } catch (_error) {
        // skills may not exist, this is normal
      }

      // Fallback for builtin assistants
      if (customAgentId.startsWith('builtin-')) {
        const presetId = customAgentId.replace('builtin-', '');
        const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          if (!rules && preset.ruleFiles) {
            try {
              const ruleFile = preset.ruleFiles[localeKey] || preset.ruleFiles['en-US'];
              if (ruleFile) {
                rules = await api.request('read-builtin-rule', { fileName: ruleFile });
              }
            } catch (e) {
              console.warn(`Failed to load builtin rules for ${customAgentId}:`, e);
            }
          }
          if (!skills && preset.skillFiles) {
            try {
              const skillFile = preset.skillFiles[localeKey] || preset.skillFiles['en-US'];
              if (skillFile) {
                skills = await api.request('read-builtin-skill', { fileName: skillFile });
              }
            } catch (_e) {
              // skills fallback failure is ok
            }
          }
        }
      }

      return { rules: rules || agentInfo.context, skills };
    },
    [localeKey]
  );

  const resolvePresetContext = useCallback(
    async (
      agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined
    ): Promise<string | undefined> => {
      const { rules } = await resolvePresetRulesAndSkills(agentInfo);
      return rules;
    },
    [resolvePresetRulesAndSkills]
  );

  const resolvePresetAgentType = useCallback(
    (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined): string => {
      if (!agentInfo) return 'gemini';
      if (agentInfo.backend !== 'custom') return agentInfo.backend as string;
      const customAgent = customAgents.find((agent) => agent.id === agentInfo.customAgentId);
      return customAgent?.presetAgentType || 'gemini';
    },
    [customAgents]
  );

  const resolveEnabledSkills = useCallback(
    (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined): string[] | undefined => {
      if (!agentInfo) return undefined;
      if (agentInfo.backend !== 'custom') return undefined;
      const customAgent = customAgents.find((agent) => agent.id === agentInfo.customAgentId);
      return customAgent?.enabledSkills;
    },
    [customAgents]
  );

  return {
    resolvePresetRulesAndSkills,
    resolvePresetContext,
    resolvePresetAgentType,
    resolveEnabledSkills,
  };
};
