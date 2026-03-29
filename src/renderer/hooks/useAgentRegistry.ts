/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * useAgentRegistry — unified Agent Identity registry hook
 * Merges all agent sources into a single Map<agentId, AgentIdentity>
 */

import { ipcBridge } from '@/common';
import { ASSISTANT_PRESETS } from '@/common/config/presets/assistantPresets';
import { ConfigStorage } from '@/common/config/storage';
import { resolveLocaleKey } from '@/common/utils';
import { ACP_BACKENDS_ALL } from '@/common/types/acpTypes';
import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

type AcpBackendConfig = {
  id: string;
  name: string;
  avatar?: string;
  isPreset?: boolean;
  enabled?: boolean;
  context?: string;
  presetAgentType?: string;
  source?: string;
  description?: string;
};

/**
 * Fetch and merge custom agents from config storage and extension-contributed assistants.
 * Keyed as 'acp.customAgents' so callers can invalidate via SWR mutate('acp.customAgents').
 */
async function fetchCustomAgents(): Promise<AcpBackendConfig[]> {
  const [agents, extAssistants] = await Promise.all([
    ConfigStorage.get('acp.customAgents'),
    ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[]),
  ]);

  const list = ((agents || []) as AcpBackendConfig[]).filter((a) => a.enabled !== false);

  // Merge extension-contributed assistants
  for (const ext of extAssistants) {
    const id = typeof ext.id === 'string' ? ext.id : '';
    if (!id || list.some((a) => a.id === id)) continue;
    list.push({
      id,
      name: typeof ext.name === 'string' ? ext.name : id,
      avatar: typeof ext.avatar === 'string' ? ext.avatar : undefined,
      isPreset: true,
      enabled: true,
      presetAgentType: typeof ext.presetAgentType === 'string' ? ext.presetAgentType : undefined,
      context: typeof ext.context === 'string' ? ext.context : undefined,
    });
  }

  return list;
}

/**
 * Hook that builds a unified agent registry from all sources:
 * - Built-in preset assistants (assistantPresets.ts)
 * - Custom agents (acp.customAgents config)
 * - CLI agents (ACP_BACKENDS_ALL)
 *
 * Returns a Map<agentId, AgentIdentity> for O(1) lookups.
 * Re-fetches automatically when SWR cache for 'acp.customAgents' is invalidated.
 */
export function useAgentRegistry(): Map<string, AgentIdentity> {
  const { i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n.language);

  const { data: customAgents = [] } = useSWR<AcpBackendConfig[]>('acp.customAgents', fetchCustomAgents, {
    revalidateOnFocus: false,
  });

  return useMemo(() => {
    const registry = new Map<string, AgentIdentity>();

    // 1. CLI agents (temporary employees)
    for (const [key, config] of Object.entries(ACP_BACKENDS_ALL)) {
      if (!config.enabled) continue;
      registry.set(key, {
        id: key,
        name: config.name,
        employeeType: 'temporary',
        source: 'cli_agent',
        backendType: key,
      });
    }

    // Also add gemini as a CLI agent
    registry.set('gemini', {
      id: 'gemini',
      name: 'Gemini',
      employeeType: 'temporary',
      source: 'cli_agent',
      backendType: 'gemini',
    });

    // 2. Built-in preset assistants (permanent employees)
    for (const preset of ASSISTANT_PRESETS) {
      const id = `preset:${preset.id}`;
      registry.set(id, {
        id,
        name: preset.nameI18n?.[localeKey] || preset.nameI18n?.['en-US'] || preset.id,
        avatar: preset.avatar,
        employeeType: 'permanent',
        source: 'preset',
        presetAgentType: preset.presetAgentType,
      });
    }

    // 3. Custom agents (permanent employees — user-created or dispatch-saved)
    for (const agent of customAgents) {
      const id = `custom:${agent.id}`;
      const source = agent.source === 'dispatch_teammate' ? 'dispatch_teammate' : 'custom';
      registry.set(id, {
        id,
        name: agent.name,
        avatar: agent.avatar,
        employeeType: 'permanent',
        source,
        backendType: agent.presetAgentType,
        description: agent.description,
      });
    }

    return registry;
  }, [customAgents, localeKey]);
}
