/**
 * Unit tests for groupingHelpers.ts
 * Phase S1: DM grouping by agent, workspace sub-groups, displayMode, buildGroupedHistory
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock localStorage-dependent module (workspaceHistory uses localStorage)
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  getWorkspaceUpdateTime: vi.fn(() => 0),
}));

// Mock SVG imports inside agentLogo.ts
vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getAgentLogo: vi.fn(() => null),
}));

// Mock timeline helpers so tests are deterministic (no real Date.now() dependency)
vi.mock('@/renderer/utils/chat/timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/utils/chat/timeline')>();
  return {
    ...actual,
    getTimelineLabel: vi.fn(() => 'Today'),
  };
});

import {
  groupConversationsByAgent,
  buildGroupedHistory,
  isConversationPinned,
  getConversationPinnedAt,
} from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';
import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';
import type { TChatConversation } from '@/common/config/storage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;

function makeConv(overrides: Partial<TChatConversation> & { extra?: Record<string, unknown> }): TChatConversation {
  _idCounter += 1;
  return {
    id: `conv-${_idCounter}`,
    name: `Conversation ${_idCounter}`,
    type: 'gemini',
    createTime: _idCounter * 1000,
    modifyTime: _idCounter * 1000,
    model: { provider: 'gemini', model: 'gemini-pro' } as TChatConversation['model'],
    extra: {} as TChatConversation['extra'],
    ...overrides,
  } as TChatConversation;
}

function makeIdentity(id: string, overrides?: Partial<AgentIdentity>): AgentIdentity {
  return {
    id,
    name: `Agent ${id}`,
    employeeType: 'permanent',
    source: 'preset',
    ...overrides,
  };
}

const t = (key: string) => key;

beforeEach(() => {
  _idCounter = 0;
  vi.clearAllMocks();
});

// ─── isConversationPinned / getConversationPinnedAt ───────────────────────────

describe('isConversationPinned', () => {
  it('returns true when extra.pinned is true', () => {
    expect(isConversationPinned(makeConv({ extra: { pinned: true } }))).toBe(true);
  });

  it('returns false when extra.pinned is false', () => {
    expect(isConversationPinned(makeConv({ extra: { pinned: false } }))).toBe(false);
  });

  it('returns false when extra has no pinned field', () => {
    expect(isConversationPinned(makeConv({ extra: {} }))).toBe(false);
  });

  it('returns false when extra is undefined', () => {
    expect(isConversationPinned(makeConv({ extra: undefined as any }))).toBe(false);
  });
});

describe('getConversationPinnedAt', () => {
  it('returns pinnedAt timestamp when set', () => {
    expect(getConversationPinnedAt(makeConv({ extra: { pinnedAt: 9999 } }))).toBe(9999);
  });

  it('returns 0 when pinnedAt is absent', () => {
    expect(getConversationPinnedAt(makeConv({ extra: {} }))).toBe(0);
  });

  it('returns 0 when extra is undefined', () => {
    expect(getConversationPinnedAt(makeConv({ extra: undefined as any }))).toBe(0);
  });
});

// ─── groupConversationsByAgent ────────────────────────────────────────────────

describe('groupConversationsByAgent', () => {
  describe('basic grouping', () => {
    it('returns an empty array when given no conversations', () => {
      const result = groupConversationsByAgent([], new Map());
      expect(result).toHaveLength(0);
    });

    it('creates one group per distinct agent', () => {
      const conv1 = makeConv({ extra: { agentId: 'preset:coder' } });
      const conv2 = makeConv({ extra: { agentId: 'preset:coder' } });
      const conv3 = makeConv({ extra: { agentId: 'preset:writer' } });

      const result = groupConversationsByAgent([conv1, conv2, conv3], new Map());
      expect(result).toHaveLength(2);
      const coderGroup = result.find((g) => g.agentId === 'preset:coder');
      expect(coderGroup?.conversations).toHaveLength(2);
    });

    it('sorts groups by latest activity time (most recent first)', () => {
      const oldConv = makeConv({ extra: { agentId: 'old-agent' }, modifyTime: 100 });
      const newConv = makeConv({ extra: { agentId: 'new-agent' }, modifyTime: 9000 });

      const result = groupConversationsByAgent([oldConv, newConv], new Map());
      expect(result[0].agentId).toBe('new-agent');
      expect(result[1].agentId).toBe('old-agent');
    });

    it('resolves agentId from type when no extra fields present (backward compat)', () => {
      const conv = makeConv({ type: 'gemini' as any, extra: {} });
      const result = groupConversationsByAgent([conv], new Map());
      expect(result[0].agentId).toBe('gemini');
    });
  });

  describe('registry lookup', () => {
    it('uses identity name from registry when available', () => {
      const conv = makeConv({ extra: { agentId: 'preset:analyst' } });
      const registry = new Map([['preset:analyst', makeIdentity('preset:analyst', { name: 'Data Analyst' })]]);

      const result = groupConversationsByAgent([conv], registry);
      expect(result[0].agentName).toBe('Data Analyst');
    });

    it('falls back to resolveAgentDisplayName when agent not in registry', () => {
      const conv = makeConv({ extra: { agentId: 'unknown-agent', agentDisplayName: 'Mystery Agent' } });
      const result = groupConversationsByAgent([conv], new Map());
      expect(result[0].agentName).toBe('Mystery Agent');
    });

    it('marks isPermanent=true for permanent employees in registry', () => {
      const conv = makeConv({ extra: { agentId: 'preset:x' } });
      const registry = new Map([['preset:x', makeIdentity('preset:x', { employeeType: 'permanent' })]]);
      const result = groupConversationsByAgent([conv], registry);
      expect(result[0].isPermanent).toBe(true);
    });

    it('marks isPermanent=false when agent is not in registry', () => {
      const conv = makeConv({ extra: { agentId: 'cli-agent' } });
      const result = groupConversationsByAgent([conv], new Map());
      expect(result[0].isPermanent).toBe(false);
    });
  });

  describe('hasActiveConversation', () => {
    it('returns true when a conversation id is in generatingIds', () => {
      const conv = makeConv({ extra: { agentId: 'a' }, id: 'gen-1' });
      const result = groupConversationsByAgent([conv], new Map(), new Set(['gen-1']));
      expect(result[0].hasActiveConversation).toBe(true);
    });

    it('returns false when no conversation is generating', () => {
      const conv = makeConv({ extra: { agentId: 'a' }, id: 'not-gen' });
      const result = groupConversationsByAgent([conv], new Map(), new Set(['other-id']));
      expect(result[0].hasActiveConversation).toBe(false);
    });

    it('returns false when generatingIds is undefined', () => {
      const conv = makeConv({ extra: { agentId: 'a' } });
      const result = groupConversationsByAgent([conv], new Map());
      expect(result[0].hasActiveConversation).toBe(false);
    });
  });

  describe('displayMode: flat', () => {
    it('uses flat mode when there are no custom workspace conversations', () => {
      const conv1 = makeConv({ extra: { agentId: 'agent-a' } });
      const conv2 = makeConv({ extra: { agentId: 'agent-a' } });
      const result = groupConversationsByAgent([conv1, conv2], new Map());
      expect(result[0].displayMode).toBe('flat');
    });

    it('puts all conversations in ungroupedConversations for flat mode', () => {
      const conv = makeConv({ extra: { agentId: 'agent-a' } });
      const result = groupConversationsByAgent([conv], new Map());
      expect(result[0].ungroupedConversations).toHaveLength(1);
      expect(result[0].workspaceSubGroups).toHaveLength(0);
    });
  });

  describe('displayMode: subtitle', () => {
    it('uses subtitle mode when all conversations belong to a single custom workspace', () => {
      const wsPath = '/home/user/project';
      const conv1 = makeConv({
        extra: { agentId: 'agent-b', customWorkspace: true, workspace: wsPath },
      });
      const conv2 = makeConv({
        extra: { agentId: 'agent-b', customWorkspace: true, workspace: wsPath },
      });
      const result = groupConversationsByAgent([conv1, conv2], new Map());
      expect(result[0].displayMode).toBe('subtitle');
    });

    it('sets singleWorkspaceDisplayName and singleWorkspacePath in subtitle mode', () => {
      const wsPath = '/home/user/myproject';
      const conv = makeConv({
        extra: { agentId: 'agent-s', customWorkspace: true, workspace: wsPath },
      });
      const result = groupConversationsByAgent([conv], new Map());
      const group = result[0];
      expect(group.displayMode).toBe('subtitle');
      expect(group.singleWorkspacePath).toBe(wsPath);
      expect(group.singleWorkspaceDisplayName).toBe('myproject');
    });
  });

  describe('displayMode: grouped', () => {
    it('uses grouped mode when conversations span multiple custom workspaces', () => {
      const conv1 = makeConv({
        extra: { agentId: 'agent-c', customWorkspace: true, workspace: '/ws/alpha' },
      });
      const conv2 = makeConv({
        extra: { agentId: 'agent-c', customWorkspace: true, workspace: '/ws/beta' },
      });
      const result = groupConversationsByAgent([conv1, conv2], new Map());
      expect(result[0].displayMode).toBe('grouped');
    });

    it('uses grouped mode when there are both workspace and ungrouped conversations', () => {
      const conv1 = makeConv({
        extra: { agentId: 'agent-d', customWorkspace: true, workspace: '/ws/alpha' },
      });
      const conv2 = makeConv({ extra: { agentId: 'agent-d' } }); // no workspace
      const result = groupConversationsByAgent([conv1, conv2], new Map());
      expect(result[0].displayMode).toBe('grouped');
    });

    it('does not set singleWorkspaceDisplayName/Path in grouped mode', () => {
      const conv1 = makeConv({
        extra: { agentId: 'agent-e', customWorkspace: true, workspace: '/ws/a' },
      });
      const conv2 = makeConv({
        extra: { agentId: 'agent-e', customWorkspace: true, workspace: '/ws/b' },
      });
      const result = groupConversationsByAgent([conv1, conv2], new Map());
      expect(result[0].singleWorkspaceDisplayName).toBeUndefined();
      expect(result[0].singleWorkspacePath).toBeUndefined();
    });
  });

  describe('temporary workspace handling', () => {
    it('treats temporary workspace paths as ungrouped (not as custom workspace)', () => {
      // Temporary workspace name pattern: <backend>-temp-<timestamp>
      const conv = makeConv({
        extra: {
          agentId: 'agent-f',
          customWorkspace: true,
          workspace: '/home/user/claude-temp-1741680000000',
        },
      });
      const result = groupConversationsByAgent([conv], new Map());
      // Should be flat since temp workspace is treated as ungrouped
      expect(result[0].displayMode).toBe('flat');
      expect(result[0].ungroupedConversations).toHaveLength(1);
    });
  });

  describe('workspace sub-groups', () => {
    it('sorts workspace sub-groups by latest activity time desc', () => {
      const oldWsConv = makeConv({
        extra: { agentId: 'agent-g', customWorkspace: true, workspace: '/ws/old' },
        modifyTime: 100,
      });
      const newWsConv = makeConv({
        extra: { agentId: 'agent-g', customWorkspace: true, workspace: '/ws/new' },
        modifyTime: 9000,
      });
      const result = groupConversationsByAgent([oldWsConv, newWsConv], new Map());
      const group = result[0];
      expect(group.workspaceSubGroups[0].workspacePath).toBe('/ws/new');
      expect(group.workspaceSubGroups[1].workspacePath).toBe('/ws/old');
    });
  });
});

// ─── buildGroupedHistory ──────────────────────────────────────────────────────

describe('buildGroupedHistory', () => {
  describe('dispatch_child filtering', () => {
    it('excludes dispatch_child conversations from all sections', () => {
      const normalConv = makeConv({ extra: { agentId: 'agent-a' } });
      const childConv = makeConv({ extra: { dispatchSessionType: 'dispatch_child' } });

      const result = buildGroupedHistory([normalConv, childConv], t);
      const allConvs = result.agentDMGroups.flatMap((g) => g.conversations);
      expect(allConvs).not.toContainEqual(expect.objectContaining({ id: childConv.id }));
    });

    it('preserves dispatch conversations in dispatchConversations list', () => {
      const dispatchConv = makeConv({ type: 'dispatch' as any });
      const result = buildGroupedHistory([dispatchConv], t);
      expect(result.dispatchConversations).toContainEqual(expect.objectContaining({ id: dispatchConv.id }));
    });

    it('excludes dispatch conversations from agentDMGroups', () => {
      const dispatchConv = makeConv({ type: 'dispatch' as any });
      const result = buildGroupedHistory([dispatchConv], t, new Map());
      expect(result.agentDMGroups).toHaveLength(0);
    });
  });

  describe('pinned conversations', () => {
    it('separates pinned conversations from normal flow', () => {
      const pinned = makeConv({ extra: { pinned: true, pinnedAt: 5000 } });
      const normal = makeConv({ extra: {} });

      const result = buildGroupedHistory([pinned, normal], t);
      expect(result.pinnedConversations).toContainEqual(expect.objectContaining({ id: pinned.id }));
      // Normal conversations end up in timeline, not pinnedConversations
      expect(result.pinnedConversations).not.toContainEqual(expect.objectContaining({ id: normal.id }));
    });

    it('does not include pinned conversations in agentDMGroups', () => {
      const pinned = makeConv({ extra: { pinned: true, agentId: 'agent-z' } });
      const result = buildGroupedHistory([pinned], t, new Map());
      expect(result.agentDMGroups).toHaveLength(0);
    });
  });

  describe('agentDMGroups population', () => {
    it('returns empty agentDMGroups when no agentRegistry is provided', () => {
      const conv = makeConv({ extra: { agentId: 'some-agent' } });
      const result = buildGroupedHistory([conv], t);
      expect(result.agentDMGroups).toHaveLength(0);
    });

    it('populates agentDMGroups when agentRegistry is provided', () => {
      const conv = makeConv({ extra: { agentId: 'agent-x' } });
      const registry = new Map([['agent-x', makeIdentity('agent-x')]]);
      const result = buildGroupedHistory([conv], t, registry);
      expect(result.agentDMGroups).toHaveLength(1);
      expect(result.agentDMGroups[0].agentId).toBe('agent-x');
    });

    it('passes generatingIds to agent grouping', () => {
      const conv = makeConv({ extra: { agentId: 'agent-y' }, id: 'active-id' });
      const registry = new Map([['agent-y', makeIdentity('agent-y')]]);
      const result = buildGroupedHistory([conv], t, registry, new Set(['active-id']));
      expect(result.agentDMGroups[0].hasActiveConversation).toBe(true);
    });
  });

  describe('empty input', () => {
    it('handles empty conversation list gracefully', () => {
      const result = buildGroupedHistory([], t, new Map());
      expect(result.pinnedConversations).toHaveLength(0);
      expect(result.dispatchConversations).toHaveLength(0);
      expect(result.agentDMGroups).toHaveLength(0);
      expect(result.timelineSections).toHaveLength(0);
    });
  });

  describe('dispatch sorting', () => {
    it('sorts dispatch conversations by activity time desc', () => {
      const old = makeConv({ type: 'dispatch' as any, modifyTime: 100 });
      const recent = makeConv({ type: 'dispatch' as any, modifyTime: 9000 });
      const result = buildGroupedHistory([old, recent], t);
      expect(result.dispatchConversations[0].id).toBe(recent.id);
      expect(result.dispatchConversations[1].id).toBe(old.id);
    });
  });
});
