/**
 * Unit tests for agentIdentity.ts
 * Phase S1: Agent Registry + DM grouping
 */

import { describe, expect, it } from 'vitest';

import { resolveAgentAvatar, resolveAgentDisplayName, resolveAgentId } from '@/renderer/utils/model/agentIdentity';
import type { TChatConversation } from '@/common/config/storage';

// Minimal factory for TChatConversation test fixtures
function makeConversation(
  overrides: Partial<TChatConversation> & { extra?: Record<string, unknown> }
): TChatConversation {
  return {
    id: 'test-id',
    name: 'Test Conversation',
    type: 'gemini',
    createTime: 1000,
    modifyTime: 2000,
    model: { provider: 'gemini', model: 'gemini-pro' } as TChatConversation['model'],
    extra: {} as TChatConversation['extra'],
    ...overrides,
  } as TChatConversation;
}

// ─── resolveAgentId ───────────────────────────────────────────────────────────

describe('resolveAgentId', () => {
  describe('priority 1: explicit agentId', () => {
    it('returns extra.agentId when present', () => {
      const conv = makeConversation({ extra: { agentId: 'preset:my-agent' } });
      expect(resolveAgentId(conv)).toBe('preset:my-agent');
    });

    it('ignores other fields when agentId is set', () => {
      const conv = makeConversation({
        extra: { agentId: 'preset:first', customAgentId: 'ignored', presetAssistantId: 'also-ignored' },
      });
      expect(resolveAgentId(conv)).toBe('preset:first');
    });
  });

  describe('dispatch_child filtering', () => {
    it('returns "dispatch_child" for conversations with dispatchSessionType=dispatch_child', () => {
      const conv = makeConversation({ extra: { dispatchSessionType: 'dispatch_child' } });
      expect(resolveAgentId(conv)).toBe('dispatch_child');
    });

    it('dispatch_child takes precedence over customAgentId', () => {
      const conv = makeConversation({
        extra: { dispatchSessionType: 'dispatch_child', customAgentId: 'some-agent' },
      });
      expect(resolveAgentId(conv)).toBe('dispatch_child');
    });
  });

  describe('dispatch conversations', () => {
    it('returns "dispatch:{id}" for type=dispatch conversations', () => {
      const conv = makeConversation({ type: 'dispatch' as any, id: 'abc123' });
      expect(resolveAgentId(conv)).toBe('dispatch:abc123');
    });
  });

  describe('priority 2: customAgentId', () => {
    it('returns "custom:{id}" from extra.customAgentId', () => {
      const conv = makeConversation({ extra: { customAgentId: 'my-custom-uuid' } });
      expect(resolveAgentId(conv)).toBe('custom:my-custom-uuid');
    });

    it('ignores presetAssistantId when customAgentId is set', () => {
      const conv = makeConversation({
        extra: { customAgentId: 'wins', presetAssistantId: 'loses' },
      });
      expect(resolveAgentId(conv)).toBe('custom:wins');
    });
  });

  describe('priority 3: presetAssistantId', () => {
    it('returns "preset:{id}" from extra.presetAssistantId', () => {
      const conv = makeConversation({ extra: { presetAssistantId: 'code-review' } });
      expect(resolveAgentId(conv)).toBe('preset:code-review');
    });

    it('ignores backend when presetAssistantId is set', () => {
      const conv = makeConversation({
        extra: { presetAssistantId: 'my-preset', backend: 'claude' },
      });
      expect(resolveAgentId(conv)).toBe('preset:my-preset');
    });
  });

  describe('priority 4: backend key', () => {
    it('returns backend key directly', () => {
      const conv = makeConversation({ extra: { backend: 'claude' } });
      expect(resolveAgentId(conv)).toBe('claude');
    });
  });

  describe('priority 5: conversation type', () => {
    it('returns conversation type as fallback', () => {
      const conv = makeConversation({ type: 'gemini', extra: {} });
      expect(resolveAgentId(conv)).toBe('gemini');
    });
  });

  describe('fallback to "unknown"', () => {
    it('returns "unknown" when no identifying fields exist', () => {
      // Force a conversation with no type
      const conv = {
        id: 'x',
        name: 'x',
        createTime: 0,
        modifyTime: 0,
        model: {} as any,
        extra: {},
        type: undefined,
      } as unknown as TChatConversation;
      expect(resolveAgentId(conv)).toBe('unknown');
    });
  });

  describe('backward compatibility — historical conversations without agentId', () => {
    it('resolves from presetAssistantId on old gemini conversations', () => {
      const conv = makeConversation({
        type: 'gemini',
        extra: { presetAssistantId: 'translator' },
      });
      expect(resolveAgentId(conv)).toBe('preset:translator');
    });

    it('resolves to type when no extra fields are present (legacy)', () => {
      const conv = makeConversation({ type: 'gemini' as any, extra: {} });
      expect(resolveAgentId(conv)).toBe('gemini');
    });
  });

  describe('edge cases', () => {
    it('ignores non-string agentId', () => {
      const conv = makeConversation({ extra: { agentId: 42, customAgentId: 'fallback' } });
      expect(resolveAgentId(conv)).toBe('custom:fallback');
    });

    it('ignores non-string customAgentId', () => {
      const conv = makeConversation({ extra: { customAgentId: true, presetAssistantId: 'p' } });
      expect(resolveAgentId(conv)).toBe('preset:p');
    });

    it('handles undefined extra gracefully', () => {
      const conv = makeConversation({ type: 'gemini', extra: undefined as any });
      expect(resolveAgentId(conv)).toBe('gemini');
    });
  });
});

// ─── resolveAgentDisplayName ──────────────────────────────────────────────────

describe('resolveAgentDisplayName', () => {
  it('returns agentDisplayName when set', () => {
    const conv = makeConversation({ extra: { agentDisplayName: 'My Agent' } });
    expect(resolveAgentDisplayName(conv)).toBe('My Agent');
  });

  it('falls back to agentName when agentDisplayName is absent', () => {
    const conv = makeConversation({ extra: { agentName: 'Code Buddy' } });
    expect(resolveAgentDisplayName(conv)).toBe('Code Buddy');
  });

  it('falls back to groupChatName for dispatch conversations', () => {
    const conv = makeConversation({ extra: { groupChatName: 'Design Review' } });
    expect(resolveAgentDisplayName(conv)).toBe('Design Review');
  });

  it('falls back to backend when no name fields are set', () => {
    const conv = makeConversation({ extra: { backend: 'claude' } });
    expect(resolveAgentDisplayName(conv)).toBe('claude');
  });

  it('falls back to conversation type as last resort', () => {
    const conv = makeConversation({ type: 'gemini', extra: {} });
    expect(resolveAgentDisplayName(conv)).toBe('gemini');
  });

  it('returns "Unknown" when no field is available', () => {
    const conv = { ...makeConversation({}), type: undefined } as unknown as TChatConversation;
    expect(resolveAgentDisplayName(conv)).toBe('Unknown');
  });

  it('prioritizes agentDisplayName over agentName', () => {
    const conv = makeConversation({ extra: { agentDisplayName: 'Display', agentName: 'Name' } });
    expect(resolveAgentDisplayName(conv)).toBe('Display');
  });
});

// ─── resolveAgentAvatar ───────────────────────────────────────────────────────

describe('resolveAgentAvatar', () => {
  it('returns agentAvatar string when present', () => {
    const conv = makeConversation({ extra: { agentAvatar: '🤖' } });
    expect(resolveAgentAvatar(conv)).toBe('🤖');
  });

  it('returns avatar from teammateConfig when agentAvatar is absent', () => {
    const conv = makeConversation({ extra: { teammateConfig: { avatar: '/path/to/avatar.svg' } } });
    expect(resolveAgentAvatar(conv)).toBe('/path/to/avatar.svg');
  });

  it('returns undefined when no avatar fields are present', () => {
    const conv = makeConversation({ extra: {} });
    expect(resolveAgentAvatar(conv)).toBeUndefined();
  });

  it('returns undefined when extra is undefined', () => {
    const conv = makeConversation({ extra: undefined as any });
    expect(resolveAgentAvatar(conv)).toBeUndefined();
  });

  it('prioritizes agentAvatar over teammateConfig.avatar', () => {
    const conv = makeConversation({
      extra: { agentAvatar: 'emoji-wins', teammateConfig: { avatar: 'config-loses' } },
    });
    expect(resolveAgentAvatar(conv)).toBe('emoji-wins');
  });

  it('returns undefined when teammateConfig exists but has no avatar', () => {
    const conv = makeConversation({ extra: { teammateConfig: {} } });
    expect(resolveAgentAvatar(conv)).toBeUndefined();
  });

  it('ignores non-string agentAvatar values', () => {
    const conv = makeConversation({ extra: { agentAvatar: 123, teammateConfig: { avatar: 'fallback' } } });
    expect(resolveAgentAvatar(conv)).toBe('fallback');
  });
});
