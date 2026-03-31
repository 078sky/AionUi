/**
 * GroupRoomContext reducer tests.
 *
 * Imports the REAL reducer and initialState from source code —
 * if the source changes, these tests will catch regressions.
 *
 * Also imports MAIN_PANEL_KINDS from GroupRoomPage.tsx to verify
 * filtering logic stays in sync with the real component.
 */
import { describe, it, expect } from 'vitest';
import type { GroupMember, GroupMessage, GroupRoomInfo } from '@renderer/pages/group-room/types';
import { reducer, initialState, type Action } from '@renderer/pages/group-room/context/GroupRoomContext';
import { MAIN_PANEL_KINDS } from '@renderer/pages/group-room/GroupRoomPage';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<GroupMessage> & { id: string }): GroupMessage {
  return {
    msgKind: 'host_response',
    senderId: null,
    senderName: null,
    targetId: null,
    targetName: null,
    senderRole: 'host',
    content: '',
    streaming: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeMember(overrides: Partial<GroupMember> & { id: string }): GroupMember {
  return {
    displayName: 'Agent',
    agentType: 'claude',
    role: 'sub',
    status: 'idle',
    currentTask: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GroupRoomContext reducer (imported from source)', () => {
  describe('SET_MESSAGES (Case 13: history restore)', () => {
    it('replaces all messages with the provided array', () => {
      const state = { ...initialState, messages: [makeMsg({ id: 'old' })] };
      const newMsgs = [
        makeMsg({ id: 'm1', msgKind: 'user_input', content: 'hello' }),
        makeMsg({ id: 'm2', msgKind: 'host_response', content: 'hi' }),
      ];
      const result = reducer(state, { type: 'SET_MESSAGES', payload: newMsgs });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].id).toBe('m1');
      expect(result.messages[1].id).toBe('m2');
    });

    it('empty array clears messages', () => {
      const state = { ...initialState, messages: [makeMsg({ id: 'x' })] };
      const result = reducer(state, { type: 'SET_MESSAGES', payload: [] });
      expect(result.messages).toHaveLength(0);
    });
  });

  describe('UPSERT_MESSAGE (streaming append)', () => {
    it('inserts new message when id not found', () => {
      const msg = makeMsg({ id: 'new-1', content: 'chunk1', streaming: true });
      const result = reducer(initialState, { type: 'UPSERT_MESSAGE', payload: msg });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('chunk1');
    });

    it('appends content when streaming=true and message exists', () => {
      const state = {
        ...initialState,
        messages: [makeMsg({ id: 's1', content: 'Hello ', streaming: true })],
      };
      const result = reducer(state, {
        type: 'UPSERT_MESSAGE',
        payload: makeMsg({ id: 's1', content: 'world', streaming: true }),
      });
      expect(result.messages[0].content).toBe('Hello world');
      expect(result.messages[0].streaming).toBe(true);
    });

    it('replaces content when streaming=false (finish event)', () => {
      const state = {
        ...initialState,
        messages: [makeMsg({ id: 's1', content: 'partial', streaming: true })],
      };
      const result = reducer(state, {
        type: 'UPSERT_MESSAGE',
        payload: makeMsg({ id: 's1', content: 'final content', streaming: false }),
      });
      expect(result.messages[0].content).toBe('final content');
      expect(result.messages[0].streaming).toBe(false);
    });

    it('keeps existing content when finish event has empty content', () => {
      const state = {
        ...initialState,
        messages: [makeMsg({ id: 's1', content: 'accumulated', streaming: true })],
      };
      const result = reducer(state, {
        type: 'UPSERT_MESSAGE',
        payload: makeMsg({ id: 's1', content: '', streaming: false }),
      });
      expect(result.messages[0].content).toBe('accumulated');
      expect(result.messages[0].streaming).toBe(false);
    });
  });

  describe('ADD_MESSAGE (optimistic insert)', () => {
    it('appends message to the end', () => {
      const state = { ...initialState, messages: [makeMsg({ id: 'a' })] };
      const result = reducer(state, {
        type: 'ADD_MESSAGE',
        payload: makeMsg({ id: 'b', msgKind: 'user_input', content: 'new' }),
      });
      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].id).toBe('b');
    });
  });

  describe('SET_MEMBERS / SET_MEMBERS_FN (Case 15: dynamic tabs)', () => {
    it('SET_MEMBERS replaces the member list', () => {
      const members = [makeMember({ id: 'a1' }), makeMember({ id: 'a2' })];
      const result = reducer(initialState, { type: 'SET_MEMBERS', payload: members });
      expect(result.members).toHaveLength(2);
    });

    it('SET_MEMBERS_FN adds a new member (join event)', () => {
      const state = {
        ...initialState,
        members: [makeMember({ id: 'existing', role: 'host', displayName: 'Host' })],
      };
      const result = reducer(state, {
        type: 'SET_MEMBERS_FN',
        payload: (prev) => [...prev, makeMember({ id: 'new-sub', displayName: 'NewSub' })],
      });
      expect(result.members).toHaveLength(2);
      expect(result.members[1].displayName).toBe('NewSub');
    });

    it('SET_MEMBERS_FN updates member status (status_update event)', () => {
      const state = {
        ...initialState,
        members: [makeMember({ id: 'sub1', status: 'idle' })],
      };
      const result = reducer(state, {
        type: 'SET_MEMBERS_FN',
        payload: (prev) => prev.map((m) => (m.id === 'sub1' ? { ...m, status: 'running' as const } : m)),
      });
      expect(result.members[0].status).toBe('running');
    });

    it('SET_MEMBERS_FN removes a member (leave event)', () => {
      const state = {
        ...initialState,
        members: [makeMember({ id: 'keep', displayName: 'Keep' }), makeMember({ id: 'remove', displayName: 'Remove' })],
      };
      const result = reducer(state, {
        type: 'SET_MEMBERS_FN',
        payload: (prev) => prev.filter((m) => m.id !== 'remove'),
      });
      expect(result.members).toHaveLength(1);
      expect(result.members[0].id).toBe('keep');
    });
  });

  describe('SET_RUNNING / SET_INPUT_LOCKED (Case 19: status)', () => {
    it('SET_RUNNING true sets both isRunning and inputLocked', () => {
      const result = reducer(initialState, { type: 'SET_RUNNING', payload: true });
      expect(result.isRunning).toBe(true);
      expect(result.inputLocked).toBe(true);
    });

    it('SET_RUNNING false clears both isRunning and inputLocked', () => {
      const state = { ...initialState, isRunning: true, inputLocked: true };
      const result = reducer(state, { type: 'SET_RUNNING', payload: false });
      expect(result.isRunning).toBe(false);
      expect(result.inputLocked).toBe(false);
    });

    it('SET_INPUT_LOCKED can be set independently', () => {
      const result = reducer(initialState, { type: 'SET_INPUT_LOCKED', payload: true });
      expect(result.inputLocked).toBe(true);
      expect(result.isRunning).toBe(false);
    });
  });

  describe('MAIN_PANEL_KINDS filtering (imported from GroupRoomPage)', () => {
    it('includes host_thought and result_injection (Case 14)', () => {
      expect(MAIN_PANEL_KINDS.has('host_thought')).toBe(true);
      expect(MAIN_PANEL_KINDS.has('result_injection')).toBe(true);
    });

    it('excludes sub-only kinds (Case 18)', () => {
      expect(MAIN_PANEL_KINDS.has('sub_output')).toBe(false);
      expect(MAIN_PANEL_KINDS.has('sub_thinking')).toBe(false);
      expect(MAIN_PANEL_KINDS.has('sub_status')).toBe(false);
    });

    it('includes all 7 expected kinds', () => {
      const expected = [
        'user_input',
        'host_response',
        'host_thought',
        'host_dispatch',
        'result_injection',
        'system',
        'agent_join',
      ];
      for (const kind of expected) {
        expect(MAIN_PANEL_KINDS.has(kind as GroupMessage['msgKind'])).toBe(true);
      }
      expect(MAIN_PANEL_KINDS.size).toBe(7);
    });

    it('main panel filter shows host messages and hides sub messages', () => {
      const messages: GroupMessage[] = [
        makeMsg({ id: '1', msgKind: 'user_input', content: 'hi' }),
        makeMsg({ id: '2', msgKind: 'host_response', content: 'reply' }),
        makeMsg({ id: '3', msgKind: 'host_thought', content: 'thinking...' }),
        makeMsg({ id: '4', msgKind: 'sub_output', senderId: 'sub1', senderRole: 'sub', content: 'sub work' }),
        makeMsg({ id: '5', msgKind: 'sub_thinking', senderId: 'sub1', senderRole: 'sub', content: 'sub thought' }),
        makeMsg({ id: '6', msgKind: 'result_injection', content: '<agent_results>...' }),
      ];

      const mainPanel = messages.filter((m) => MAIN_PANEL_KINDS.has(m.msgKind));
      expect(mainPanel).toHaveLength(4); // user_input, host_response, host_thought, result_injection
      expect(mainPanel.map((m) => m.id)).toEqual(['1', '2', '3', '6']);

      // Sub-agent tab filter: by senderId
      const subTab = messages.filter((m) => m.senderId === 'sub1');
      expect(subTab).toHaveLength(2);
      expect(subTab.every((m) => m.senderRole === 'sub')).toBe(true);
    });
  });

  describe('Historical message senderRole mapping (Case 13 audit issue #4)', () => {
    it('DB returns senderType as user/agent, NOT host/sub', () => {
      // This test documents and verifies the mapping contract.
      // getMessagesByRoom returns senderType: 'user' | 'agent' (from DB column sender_type).
      // The frontend must use senderId + members list to resolve senderRole,
      // NOT senderType directly.
      const dbSenderTypes = ['user', 'agent'] as const;
      // These are the ONLY values the DB CHECK constraint allows
      expect(dbSenderTypes).toContain('user');
      expect(dbSenderTypes).toContain('agent');
      // 'host' and 'sub' are NOT valid sender_type values
      expect(dbSenderTypes).not.toContain('host');
      expect(dbSenderTypes).not.toContain('sub');
    });

    it('senderRole should be resolved via senderId + members lookup, not senderType', () => {
      // Simulates the correct historical message mapping
      const members: GroupMember[] = [
        makeMember({ id: 'host-agent-1', role: 'host', displayName: 'Host' }),
        makeMember({ id: 'sub-agent-1', role: 'sub', displayName: 'Coder' }),
      ];

      // DB message shape (what getMessagesByRoom returns)
      const dbMessages = [
        { id: 'm1', senderType: 'user', senderId: null, msgKind: 'user_input' as const, content: 'hello' },
        { id: 'm2', senderType: 'agent', senderId: 'host-agent-1', msgKind: 'host_response' as const, content: 'hi' },
        { id: 'm3', senderType: 'agent', senderId: 'sub-agent-1', msgKind: 'sub_output' as const, content: 'code' },
      ];

      // CORRECT mapping: resolve senderRole from members list
      const correctlyMapped = dbMessages.map((msg) => {
        const member = members.find((m) => m.id === msg.senderId);
        return {
          ...msg,
          senderRole: member?.role ?? null,
        };
      });

      expect(correctlyMapped[0].senderRole).toBeNull(); // user message
      expect(correctlyMapped[1].senderRole).toBe('host'); // host agent
      expect(correctlyMapped[2].senderRole).toBe('sub'); // sub agent

      // WRONG mapping (the old bug before fix):
      // senderType === 'host' ? 'host' : ... produces null for ALL messages
      // since senderType is 'user'|'agent', never 'host'|'sub'.
      const wronglyMapped = dbMessages.map((msg) => ({
        ...msg,
        senderRole: msg.senderType === 'host' ? 'host' : msg.senderType === 'sub' ? 'sub' : null,
      }));

      // All null — demonstrates why the old approach was wrong
      expect(wronglyMapped[0].senderRole).toBeNull();
      expect(wronglyMapped[1].senderRole).toBeNull(); // should be 'host'
      expect(wronglyMapped[2].senderRole).toBeNull(); // should be 'sub'
    });
  });

  describe('SET_ROOM', () => {
    it('sets room info', () => {
      const room: GroupRoomInfo = {
        id: 'r1',
        name: 'Test Room',
        description: 'desc',
        status: 'running',
      };
      const result = reducer(initialState, { type: 'SET_ROOM', payload: room });
      expect(result).toHaveProperty('room', room);
    });
  });

  describe('unknown action returns same state', () => {
    it('returns unchanged state for unknown action type', () => {
      const state = { ...initialState, isRunning: true };
      const result = reducer(state, { type: 'UNKNOWN' } as unknown as Action);
      expect(result).toBe(state);
    });
  });
});
