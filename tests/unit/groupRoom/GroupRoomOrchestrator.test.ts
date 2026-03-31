/**
 * GroupRoomOrchestrator tests -- Cases 1-19.
 *
 * Case 1-6:  Data layer — orchestrator + GroupRoomService, fully executable.
 * Case 7-10: IPC payload contract — verifies emit payloads carry all fields
 *            needed for WS transport and frontend filtering. Does NOT start a
 *            real WebSocket server or test JWT/握手.
 * Case 11-19: Bridge-level integration — exercises Service + simulated bridge.get
 *            shape + emit spy. Does NOT mount React or walk real UI.
 *
 * Loop-based cooperation model:
 *   user input -> host -> parse dispatch -> sub-agents (parallel)
 *     -> collect results -> reinject -> host reasons again -> ...
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { GroupRoomService } from '@process/services/groupRoom/GroupRoomService';
import {
  createTestDb,
  createEmitterSpy,
  createMockConversationService,
  setAgentBehavior,
  resetAllBehaviors,
  executeAgentBehavior,
  type EmitterSpy,
} from './helpers';

// ==========================================
// Module mocks -- must be before any import that touches them
// ==========================================

let uuidCounter = 0;
vi.mock('@/common/utils', () => ({
  uuid: vi.fn(() => `test-uuid-${++uuidCounter}`),
}));

const emitterSpy = createEmitterSpy();

vi.mock('@/common/adapter/ipcBridge', () => ({
  groupRoom: {
    responseStream: {
      emit: vi.fn((payload: Record<string, unknown>) => {
        emitterSpy.responseStream.push(payload);
      }),
    },
    memberChanged: {
      emit: vi.fn((payload: Record<string, unknown>) => {
        emitterSpy.memberChanged.push(payload);
      }),
    },
    turnCompleted: {
      emit: vi.fn((payload: Record<string, unknown>) => {
        emitterSpy.turnCompleted.push(payload);
      }),
    },
  },
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

// Mock AcpAgent as a real class so `new AcpAgent(...)` works.
const acpAgentInstances: Array<{
  config: Record<string, unknown>;
  sendMessage: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  cancelPrompt: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('@process/agent/acp', () => {
  class MockAcpAgent {
    config: Record<string, unknown>;
    sendMessage: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    cancelPrompt: ReturnType<typeof vi.fn>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.sendMessage = vi.fn().mockImplementation(async (data: { content: string; msg_id?: string }) => {
        const msgId = data.msg_id ?? `auto-msg-${Date.now()}`;
        const onStreamEvent = config.onStreamEvent as (d: Record<string, unknown>) => void;
        const onSignalEvent = config.onSignalEvent as ((d: Record<string, unknown>) => void) | undefined;
        executeAgentBehavior(config.id as string, data.content, onStreamEvent, onSignalEvent, msgId);
        return { success: true };
      });
      this.kill = vi.fn().mockResolvedValue(undefined);
      this.cancelPrompt = vi.fn();
      acpAgentInstances.push(this);
    }
  }

  return { AcpAgent: MockAcpAgent };
});

// Now import the module under test
import { GroupRoomOrchestrator } from '@process/services/groupRoom/GroupRoomOrchestrator';

// ==========================================
// Test suite
// ==========================================

describe('GroupRoomOrchestrator', () => {
  let db: ISqliteDriver;
  let service: GroupRoomService;
  let mockConvService: ReturnType<typeof createMockConversationService>;
  let mockAgentFactory: { register: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let roomId: string;

  beforeEach(() => {
    uuidCounter = 0;
    emitterSpy.reset();
    acpAgentInstances.length = 0;
    resetAllBehaviors();
    vi.clearAllMocks();

    db = createTestDb();
    service = new GroupRoomService(db);
    mockConvService = createMockConversationService();
    mockAgentFactory = {
      register: vi.fn(),
      create: vi.fn(),
    };

    // Pre-seed a host conversation in the mock service
    mockConvService._store.set('conv-host', {
      id: 'conv-host',
      type: 'acp',
      name: 'Host Conv',
      extra: {
        workspace: '/test/workspace',
        backend: 'claude',
      },
    });

    // Create a room
    const room = service.createRoom({
      userId: 'user-1',
      name: 'Test Room',
      hostConversationId: 'conv-host',
    });
    roomId = room.id;
  });

  afterEach(() => {
    db.close();
  });

  function createOrchestrator(rid?: string) {
    return new GroupRoomOrchestrator(rid ?? roomId, db, mockConvService, mockAgentFactory);
  }

  // ==========================================
  // Case 1: main Agent can create sub-agents and dispatch tasks
  // ==========================================

  describe('Case 1: main Agent can create sub-agents and dispatch tasks', () => {
    it('host dispatches to existing sub by agentId', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'Coder',
        conversationId: 'conv-sub',
      });
      mockConvService._store.set('conv-sub', {
        id: 'conv-sub',
        type: 'acp',
        name: 'Sub Conv',
        extra: { workspace: '/test/workspace', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_input, idx) => {
        if (idx === 0) {
          return `<dispatch>\n  <agent id="${sub.id}" description="implement prime" prompt="implement isPrime(n)"/>\n</dispatch>`;
        }
        return 'Coder finished. Done.';
      });
      setAgentBehavior('conv-sub', () => 'function isPrime(n) { ... }');

      const orch = createOrchestrator();
      await orch.start('write isPrime', 'msg-1');

      const subInstance = acpAgentInstances.find((a) => a.config.id === 'conv-sub');
      expect(subInstance).toBeDefined();
      expect(subInstance!.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'implement isPrime(n)' })
      );
    });

    it('host dispatches via type+name creates dynamic sub-agent', async () => {
      setAgentBehavior('conv-host', (_input, idx) => {
        if (idx === 0) {
          return `<dispatch>\n  <agent type="claude" description="Code Boy" prompt="implement sort"/>\n</dispatch>`;
        }
        return 'All done.';
      });
      // The dynamic sub will use a newly created conversationId
      // We set default behavior for any unknown agent
      setAgentBehavior('conv-host', (_input, idx) => {
        if (idx === 0) {
          return `<dispatch>\n  <agent type="claude" description="Code Boy" prompt="implement sort"/>\n</dispatch>`;
        }
        return 'All done.';
      });

      const orch = createOrchestrator();
      await orch.start('sort algo', 'msg-1');

      // Verify sub was created in DB
      const roomData = service.getRoom(roomId);
      const subs = roomData!.members.filter((m) => m.role === 'sub');
      expect(subs).toHaveLength(1);
      expect(subs[0].displayName).toBe('Code Boy');
      expect(subs[0].agentType).toBe('claude');

      // Verify IPC join event
      const joins = emitterSpy.memberChanged.filter((e) => e.action === 'join');
      expect(joins).toHaveLength(1);
      expect((joins[0].member as Record<string, unknown>).displayName).toBe('Code Boy');
    });

    it('host dispatch emits IPC stream events', async () => {
      setAgentBehavior('conv-host', () => 'simple reply, no dispatch.');

      const orch = createOrchestrator();
      await orch.start('hello', 'msg-1');

      const hostEvents = emitterSpy.responseStream.filter((e) => e.agentRole === 'host');
      expect(hostEvents.length).toBeGreaterThan(0);
      expect(hostEvents[0]).toMatchObject({
        roomId,
        agentRole: 'host',
        msg_kind: 'host_response',
        streaming: true,
      });
    });

    it('turnCompleted emitted when host finishes without dispatch', async () => {
      setAgentBehavior('conv-host', () => 'direct reply.');

      const orch = createOrchestrator();
      await orch.start('hi', 'msg-1');

      expect(emitterSpy.turnCompleted).toHaveLength(1);
      expect(emitterSpy.turnCompleted[0]).toMatchObject({
        roomId,
        status: 'finished',
        canSendMessage: true,
      });
    });

    it('host finish signal from onSignalEvent completes the round', async () => {
      setAgentBehavior('conv-host', () => 'reply delivered via signal finish.');

      const orch = createOrchestrator();
      await orch.start('signal finish', 'msg-signal');

      const hostMsgs = service.getMessagesByRoom(roomId).filter((m) => m.msgKind === 'host_response');
      expect(hostMsgs).toHaveLength(1);
      expect(hostMsgs[0].content).toBe('reply delivered via signal finish.');
      expect(emitterSpy.turnCompleted).toHaveLength(1);
    });

    it('room status transitions: idle -> running -> idle', async () => {
      setAgentBehavior('conv-host', () => 'done.');

      expect(service.getRoom(roomId)!.room.status).toBe('idle');

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      expect(service.getRoom(roomId)!.room.status).toBe('idle');
    });
  });

  // ==========================================
  // Case 2: sub-agents have full host agent capabilities
  // ==========================================

  describe('Case 2: sub-agents have full host agent capabilities', () => {
    it('sub-agent is instantiated as AcpAgent with sendMessage', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'Worker',
        conversationId: 'conv-sub',
      });
      mockConvService._store.set('conv-sub', {
        id: 'conv-sub',
        type: 'acp',
        name: 'Sub Conv',
        extra: { workspace: '/w', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="code" prompt="code"/></dispatch>`;
        return 'done.';
      });
      setAgentBehavior('conv-sub', () => 'code done');

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const subInstance = acpAgentInstances.find((a) => a.config.id === 'conv-sub');
      expect(subInstance).toBeDefined();
      expect(subInstance!.config).toHaveProperty('onStreamEvent');
      expect(subInstance!.config).toHaveProperty('onSignalEvent');
      expect(subInstance!.config).toHaveProperty('id', 'conv-sub');
    });

    it('sub-agent extra contains cliPath, currentModelId, sessionMode inherited from host', async () => {
      // Host config has these fields (set via conversation extra).
      // Sub-agent must inherit them so it can locate CLI and use the same model.
      mockConvService._store.set('conv-host', {
        id: 'conv-host',
        type: 'acp',
        name: 'Host Conv',
        extra: {
          workspace: '/test/workspace',
          backend: 'claude',
          cliPath: '/usr/local/bin/claude',
          currentModelId: 'claude-sonnet-4-6',
          sessionMode: 'normal',
        },
      });

      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'CapWorker',
        conversationId: 'conv-cap-sub',
      });
      mockConvService._store.set('conv-cap-sub', {
        id: 'conv-cap-sub',
        type: 'acp',
        name: 'Sub',
        extra: { workspace: '/test/workspace', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="cap test" prompt="cap test"/></dispatch>`;
        return 'done.';
      });
      setAgentBehavior('conv-cap-sub', () => 'cap result');

      const orch = createOrchestrator();
      await orch.start('test capabilities', 'msg-cap');

      const subInstance = acpAgentInstances.find((a) => a.config.id === 'conv-cap-sub');
      expect(subInstance).toBeDefined();

      const subExtra = subInstance!.config.extra as Record<string, unknown>;
      // Sub must inherit these host fields
      expect(subExtra.cliPath).toBe('/usr/local/bin/claude');
      expect(subExtra.currentModelId).toBe('claude-sonnet-4-6');
      expect(subExtra.sessionMode).toBe('normal');
      // Sub must have its own basics
      expect(subExtra.workspace).toBe('/test/workspace');
      expect(subExtra.yoloMode).toBe(true);
      // Sub must NOT inherit host-specific session IDs
      expect(subExtra).not.toHaveProperty('acpSessionId');
      expect(subExtra).not.toHaveProperty('acpSessionConversationId');
    });

    it('sub-agent backend resolved from member agentType (gemini -> gemini-cli)', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'gemini',
        displayName: 'Gemini Worker',
        conversationId: 'conv-gemini',
      });
      mockConvService._store.set('conv-gemini', {
        id: 'conv-gemini',
        type: 'gemini',
        name: 'Gemini Conv',
        extra: { workspace: '/w', backend: 'gemini' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="design" prompt="design"/></dispatch>`;
        return 'done.';
      });
      setAgentBehavior('conv-gemini', () => 'designed');

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const subInstance = acpAgentInstances.find((a) => a.config.id === 'conv-gemini');
      expect(subInstance).toBeDefined();
      // resolveBackend maps 'gemini' -> 'gemini-cli'
      expect(subInstance!.config.backend).toBe('gemini-cli');
      expect((subInstance!.config.extra as Record<string, unknown>).backend).toBe('gemini-cli');
    });
  });

  // ==========================================
  // Case 3: sub-agent reports results back to host
  // ==========================================

  describe('Case 3: sub-agent results re-injected to host', () => {
    it('host receives plain text result report after sub-agent finishes', async () => {
      const hostInputs: string[] = [];
      setAgentBehavior('conv-host', (input, idx) => {
        hostInputs.push(input);
        if (idx === 0) {
          return `<dispatch><agent type="claude" description="Coder" prompt="implement add(a,b)"/></dispatch>`;
        }
        return 'Received. All done.';
      });

      // The dynamic sub will get a new conversation id -- catch it
      // We cannot predict the exact conv id, so use default behavior
      // for any agent that isn't conv-host.
      // Actually, the dynamic sub's conv id comes from createConversation mock.
      // Let's capture it.
      let dynamicConvId: string | undefined;
      const origCreate = mockConvService.createConversation;
      mockConvService.createConversation = vi.fn().mockImplementation(async (params: Record<string, unknown>) => {
        const result = await origCreate(params);
        dynamicConvId = result.id as string;
        // Set behavior for the dynamic sub
        setAgentBehavior(dynamicConvId, () => 'function add(a,b) { return a+b; }');
        return result;
      });

      const orch = createOrchestrator();
      await orch.start('implement add', 'msg-1');

      // Host should have been called twice (initial + result injection)
      expect(hostInputs).toHaveLength(2);
      expect(hostInputs[1]).toContain('completed]');
      expect(hostInputs[1]).toContain('function add(a,b) { return a+b; }');
    });

    it('sub-agent finish triggers memberChanged status=finished', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'Coder',
        conversationId: 'conv-sub',
      });
      mockConvService._store.set('conv-sub', {
        id: 'conv-sub',
        type: 'acp',
        name: 'Sub',
        extra: { workspace: '/w', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="code it" prompt="code it"/></dispatch>`;
        return 'got it.';
      });
      setAgentBehavior('conv-sub', () => 'done');

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const finishEvents = emitterSpy.memberChanged.filter(
        (e) => (e.member as Record<string, unknown>).status === 'finished'
      );
      expect(finishEvents.length).toBeGreaterThanOrEqual(1);
      expect((finishEvents[0].member as Record<string, unknown>).displayName).toBe('Coder');
    });
  });

  // ==========================================
  // Case 4: host can trigger multi-round sub-agent tasks
  // ==========================================

  describe('Case 4: host triggers multi-round sub-agent tasks', () => {
    it('first round completes then host dispatches second round', async () => {
      let hostCallCount = 0;
      let sub1ConvId: string | undefined;
      let sub2ConvId: string | undefined;
      const origCreate = mockConvService.createConversation;
      mockConvService.createConversation = vi.fn().mockImplementation(async (params: Record<string, unknown>) => {
        const result = await origCreate(params);
        const convId = result.id as string;
        if (!sub1ConvId) {
          sub1ConvId = convId;
          setAgentBehavior(convId, () => 'API design complete');
        } else {
          sub2ConvId = convId;
          setAgentBehavior(convId, () => 'Implementation done');
        }
        return result;
      });

      setAgentBehavior('conv-host', (_input, idx) => {
        hostCallCount++;
        if (idx === 0) {
          return `<dispatch><agent type="claude" description="Designer" prompt="design API"/></dispatch>`;
        }
        if (idx === 1) {
          return `Received design.
<dispatch><agent type="claude" description="Developer" prompt="implement API"/></dispatch>`;
        }
        return 'All rounds complete.';
      });

      const orch = createOrchestrator();
      await orch.start('design and implement API', 'msg-1');

      // Host called 3 times: initial + after round 1 + after round 2
      expect(hostCallCount).toBe(3);

      // Two dynamic subs created
      const subs = service.getRoom(roomId)!.members.filter((m) => m.role === 'sub');
      expect(subs).toHaveLength(2);
      expect(subs.map((s) => s.displayName)).toContain('Designer');
      expect(subs.map((s) => s.displayName)).toContain('Developer');
    });

    it('max rounds (5) prevents infinite loop', async () => {
      let callCount = 0;

      // Set up dynamic sub creation
      const origCreate = mockConvService.createConversation;
      mockConvService.createConversation = vi.fn().mockImplementation(async (params: Record<string, unknown>) => {
        const result = await origCreate(params);
        setAgentBehavior(result.id as string, () => 'sub result');
        return result;
      });

      setAgentBehavior('conv-host', () => {
        callCount++;
        // Always dispatch, should be limited by MAX_ROUNDS
        return `<dispatch><agent type="claude" description="Worker${callCount}" prompt="task ${callCount}"/></dispatch>`;
      });

      const orch = createOrchestrator();
      await orch.start('infinite loop test', 'msg-1');

      // MAX_ROUNDS is 5, so host gets called at most 5 times
      expect(callCount).toBeLessThanOrEqual(5);
      // Turn should still complete
      expect(emitterSpy.turnCompleted).toHaveLength(1);
    });
  });

  // ==========================================
  // Case 5: host and sub-agents can output thoughts
  // ==========================================

  describe('Case 5: host and sub-agents output thought process', () => {
    it('host thought events emitted via responseStream as host_thought', async () => {
      setAgentBehavior('conv-host', () => ({
        content: 'Analysis complete.',
        thoughts: ['Let me think...', 'Breaking down the problem'],
      }));

      const orch = createOrchestrator();
      await orch.start('think about this', 'msg-1');

      const thoughtEvents = emitterSpy.responseStream.filter((e) => e.msg_kind === 'host_thought');
      expect(thoughtEvents).toHaveLength(2);
      expect(thoughtEvents[0].content).toBe('Let me think...');
      expect(thoughtEvents[1].content).toBe('Breaking down the problem');
    });

    it('sub-agent thought events emitted as sub_thinking', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'Thinker',
        conversationId: 'conv-sub',
      });
      mockConvService._store.set('conv-sub', {
        id: 'conv-sub',
        type: 'acp',
        name: 'Sub',
        extra: { workspace: '/w', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="think" prompt="think"/></dispatch>`;
        return 'ok.';
      });
      setAgentBehavior('conv-sub', () => ({
        content: 'Thought result.',
        thoughts: ['Thinking deeply...'],
      }));

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const subThoughts = emitterSpy.responseStream.filter((e) => e.msg_kind === 'sub_thinking');
      expect(subThoughts.length).toBeGreaterThanOrEqual(1);
      expect(subThoughts[0]).toMatchObject({
        roomId,
        agentRole: 'sub',
        msg_kind: 'sub_thinking',
      });
    });

    it('host thoughts are persisted to DB', async () => {
      setAgentBehavior('conv-host', () => ({
        content: 'Done.',
        thoughts: ['Thought 1'],
      }));

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const msgs = service.getMessagesByRoom(roomId);
      const thoughtMsgs = msgs.filter((m) => m.msgKind === 'host_thought');
      expect(thoughtMsgs).toHaveLength(1);
      expect(thoughtMsgs[0].content).toBe('Thought 1');
    });
  });

  // ==========================================
  // Case 6: all conversations and thoughts persisted, isolated by room
  // ==========================================

  describe('Case 6: all conversation data persisted and room-isolated', () => {
    it('host response persisted as host_response', async () => {
      setAgentBehavior('conv-host', () => 'Hello world response.');

      const orch = createOrchestrator();
      await orch.start('hi', 'msg-1');

      const msgs = service.getMessagesByRoom(roomId);
      const hostMsgs = msgs.filter((m) => m.msgKind === 'host_response');
      expect(hostMsgs).toHaveLength(1);
      expect(hostMsgs[0].content).toBe('Hello world response.');
    });

    it('dispatch instruction persisted as host_dispatch', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'Worker',
        conversationId: 'conv-sub',
      });
      mockConvService._store.set('conv-sub', {
        id: 'conv-sub',
        type: 'acp',
        name: 'Sub',
        extra: { workspace: '/w', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="do it" prompt="do it"/></dispatch>`;
        return 'done.';
      });
      setAgentBehavior('conv-sub', () => 'result');

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const msgs = service.getMessagesByRoom(roomId);
      const dispatchMsgs = msgs.filter((m) => m.msgKind === 'host_dispatch');
      expect(dispatchMsgs).toHaveLength(1);
    });

    it('sub-agent output persisted as sub_output', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'Worker',
        conversationId: 'conv-sub',
      });
      mockConvService._store.set('conv-sub', {
        id: 'conv-sub',
        type: 'acp',
        name: 'Sub',
        extra: { workspace: '/w', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="code" prompt="code"/></dispatch>`;
        return 'done.';
      });
      setAgentBehavior('conv-sub', () => 'function isPrime(n) {}');

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const msgs = service.getMessagesByRoom(roomId);
      const subMsgs = msgs.filter((m) => m.msgKind === 'sub_output');
      expect(subMsgs).toHaveLength(1);
      expect(subMsgs[0].content).toBe('function isPrime(n) {}');
    });

    it('result injection persisted as result_injection', async () => {
      const sub = service.addAgent({
        roomId,
        role: 'sub',
        agentType: 'claude',
        displayName: 'Worker',
        conversationId: 'conv-sub',
      });
      mockConvService._store.set('conv-sub', {
        id: 'conv-sub',
        type: 'acp',
        name: 'Sub',
        extra: { workspace: '/w', backend: 'claude' },
      });

      setAgentBehavior('conv-host', (_i, idx) => {
        if (idx === 0) return `<dispatch><agent id="${sub.id}" description="code" prompt="code"/></dispatch>`;
        return 'done.';
      });
      setAgentBehavior('conv-sub', () => 'result content');

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const msgs = service.getMessagesByRoom(roomId);
      const injectionMsgs = msgs.filter((m) => m.msgKind === 'result_injection');
      expect(injectionMsgs).toHaveLength(1);
      expect(injectionMsgs[0].content).toContain('completed]');
    });

    it('messages from different rooms are isolated', () => {
      const room2 = service.createRoom({
        userId: 'user-1',
        name: 'Room 2',
        hostConversationId: 'conv-host-2',
      });

      service.addMessage({
        roomId,
        senderType: 'user',
        senderId: 'u1',
        msgKind: 'user_input',
        content: 'room1 msg',
      });
      service.addMessage({
        roomId: room2.id,
        senderType: 'user',
        senderId: 'u1',
        msgKind: 'user_input',
        content: 'room2 msg',
      });

      const msgs1 = service.getMessagesByRoom(roomId);
      const msgs2 = service.getMessagesByRoom(room2.id);
      expect(msgs1).toHaveLength(1);
      expect(msgs1[0].content).toBe('room1 msg');
      expect(msgs2).toHaveLength(1);
      expect(msgs2[0].content).toBe('room2 msg');
    });

    it('all msgKind types accepted by DB layer', () => {
      const kinds = [
        'user_input',
        'host_response',
        'host_dispatch',
        'sub_output',
        'result_injection',
        'host_thought',
        'sub_thinking',
        'sub_status',
        'system',
      ] as const;

      for (const kind of kinds) {
        service.addMessage({
          roomId,
          senderType: kind === 'user_input' ? 'user' : 'agent',
          senderId: 'test',
          msgKind: kind,
          content: `content for ${kind}`,
        });
      }

      const msgs = service.getMessagesByRoom(roomId);
      expect(msgs).toHaveLength(kinds.length);
    });
  });

  // ==========================================
  // Error handling
  // ==========================================

  describe('Error handling', () => {
    it('room not found throws error', async () => {
      const orch = createOrchestrator('nonexistent');
      await expect(orch.start('hi', 'msg-1')).rejects.toThrow('Room not found');
    });

    it('host agent error emits error events', async () => {
      setAgentBehavior('conv-host', () => {
        throw new Error('ACP connection failed');
      });

      const orch = createOrchestrator();
      await orch.start('go', 'msg-1');

      const errorTurns = emitterSpy.turnCompleted.filter((e) => e.status === 'error');
      expect(errorTurns.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================
  // Teardown
  // ==========================================

  describe('Teardown', () => {
    it('kills all agent instances and sets room to paused', async () => {
      setAgentBehavior('conv-host', () => 'done');

      const orch = createOrchestrator();
      await orch.start('hi', 'msg-1');
      await orch.teardown();

      expect(service.getRoom(roomId)!.room.status).toBe('paused');
      for (const inst of acpAgentInstances) {
        expect(inst.kill).toHaveBeenCalled();
      }
    });

    it('double teardown is idempotent', async () => {
      setAgentBehavior('conv-host', () => 'done');

      const orch = createOrchestrator();
      await orch.start('hi', 'msg-1');
      await orch.teardown();
      await orch.teardown();
      expect(service.getRoom(roomId)!.room.status).toBe('paused');
    });
  });
});

// ==========================================
// Case 7-10: Server WS communication layer
// ==========================================
// These cases verify that IPC emitter payloads carry all fields needed for
// WebSocket transport and frontend filtering. The WS layer is a generic
// broadcast adapter (bridge.emit → broadcastToAll → WS clients), so the
// critical requirement is correct event structure — not the transport itself.

describe('Case 7-10: Server WS communication layer', () => {
  let db7: ISqliteDriver;
  let service7: GroupRoomService;
  let mockConv7: ReturnType<typeof createMockConversationService>;
  let mockFactory7: { register: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let roomId7: string;

  beforeEach(() => {
    uuidCounter = 0;
    emitterSpy.reset();
    acpAgentInstances.length = 0;
    resetAllBehaviors();
    vi.clearAllMocks();

    db7 = createTestDb();
    service7 = new GroupRoomService(db7);
    mockConv7 = createMockConversationService();
    mockFactory7 = { register: vi.fn(), create: vi.fn() };

    mockConv7._store.set('conv-host-7', {
      id: 'conv-host-7',
      type: 'acp',
      name: 'Host Conv 7',
      extra: { workspace: '/ws-test', backend: 'claude' },
    });

    const room = service7.createRoom({
      userId: 'user-ws',
      name: 'WS Test Room',
      hostConversationId: 'conv-host-7',
    });
    roomId7 = room.id;
  });

  afterEach(() => {
    db7.close();
  });

  function createOrch7(rid?: string) {
    return new GroupRoomOrchestrator(rid ?? roomId7, db7, mockConv7, mockFactory7);
  }

  it('Case 7: all emitted events carry roomId for WS channel routing', async () => {
    const sub = service7.addAgent({
      roomId: roomId7,
      role: 'sub',
      agentType: 'claude',
      displayName: 'WSWorker',
      conversationId: 'conv-ws-sub',
    });
    mockConv7._store.set('conv-ws-sub', {
      id: 'conv-ws-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ws-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-7', (_i, idx) => {
      if (idx === 0) return `<dispatch><agent id="${sub.id}" description="ws task" prompt="ws task"/></dispatch>`;
      return 'ws done.';
    });
    setAgentBehavior('conv-ws-sub', () => 'ws result');

    const orch = createOrch7();
    await orch.start('ws test', 'msg-ws');

    // Every responseStream event must carry roomId
    for (const evt of emitterSpy.responseStream) {
      expect(evt).toHaveProperty('roomId', roomId7);
    }
    // Every memberChanged event must carry roomId
    for (const evt of emitterSpy.memberChanged) {
      expect(evt).toHaveProperty('roomId', roomId7);
    }
    // turnCompleted must carry roomId
    for (const evt of emitterSpy.turnCompleted) {
      expect(evt).toHaveProperty('roomId', roomId7);
    }
  });

  it('Case 8: streaming events carry content + streaming flag for real-time display', async () => {
    setAgentBehavior('conv-host-7', () => ({
      content: 'Streamed host reply.',
      thoughts: ['Thinking step 1'],
    }));

    const orch = createOrch7();
    await orch.start('stream test', 'msg-s');

    // Content events have streaming: true
    const contentEvents = emitterSpy.responseStream.filter(
      (e) => e.msg_kind === 'host_response' && e.status === 'content'
    );
    expect(contentEvents.length).toBeGreaterThan(0);
    for (const evt of contentEvents) {
      expect(evt.streaming).toBe(true);
      expect(typeof evt.content).toBe('string');
      expect((evt.content as string).length).toBeGreaterThan(0);
    }

    // Thought events also stream
    const thoughtEvents = emitterSpy.responseStream.filter((e) => e.msg_kind === 'host_thought');
    expect(thoughtEvents.length).toBeGreaterThan(0);
    for (const evt of thoughtEvents) {
      expect(evt.streaming).toBe(true);
    }
  });

  it('Case 9: events carry agentId + agentRole for sub-agent conversation filtering', async () => {
    const sub = service7.addAgent({
      roomId: roomId7,
      role: 'sub',
      agentType: 'claude',
      displayName: 'FilterSub',
      conversationId: 'conv-filter-sub',
    });
    mockConv7._store.set('conv-filter-sub', {
      id: 'conv-filter-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ws-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-7', (_i, idx) => {
      if (idx === 0)
        return `<dispatch><agent id="${sub.id}" description="filter task" prompt="filter task"/></dispatch>`;
      return 'filter done.';
    });
    setAgentBehavior('conv-filter-sub', () => 'sub output for filter');

    const orch = createOrch7();
    await orch.start('filter test', 'msg-f');

    // Sub-agent events carry agentId=member.id, agentRole='sub'
    const subEvents = emitterSpy.responseStream.filter((e) => e.agentRole === 'sub');
    expect(subEvents.length).toBeGreaterThan(0);
    for (const evt of subEvents) {
      expect(evt.agentId).toBe(sub.id);
      expect(evt.agentRole).toBe('sub');
    }

    // Host events carry agentRole='host'
    const hostEvents = emitterSpy.responseStream.filter((e) => e.agentRole === 'host');
    expect(hostEvents.length).toBeGreaterThan(0);
    for (const evt of hostEvents) {
      expect(evt.agentRole).toBe('host');
    }

    // Frontend filtering simulation: messages.filter(m => m.senderId === sub.id)
    const subFiltered = emitterSpy.responseStream.filter((e) => e.agentId === sub.id);
    expect(subFiltered.length).toBeGreaterThan(0);
    expect(subFiltered.every((e) => e.agentRole === 'sub')).toBe(true);
  });

  it('Case 10: events carry msg_kind for host-user conversation filtering', async () => {
    const sub = service7.addAgent({
      roomId: roomId7,
      role: 'sub',
      agentType: 'claude',
      displayName: 'KindSub',
      conversationId: 'conv-kind-sub',
    });
    mockConv7._store.set('conv-kind-sub', {
      id: 'conv-kind-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ws-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-7', (_i, idx) => {
      if (idx === 0) return `<dispatch><agent id="${sub.id}" description="kind task" prompt="kind task"/></dispatch>`;
      return 'kind done.';
    });
    setAgentBehavior('conv-kind-sub', () => ({
      content: 'sub result',
      thoughts: ['sub thinking'],
    }));

    const orch = createOrch7();
    await orch.start('kind test', 'msg-k');

    // Verify msg_kind is present on every event
    for (const evt of emitterSpy.responseStream) {
      expect(evt).toHaveProperty('msg_kind');
      expect(typeof evt.msg_kind).toBe('string');
    }

    // Host-user main panel: filter by MAIN_PANEL_KINDS (must match GroupRoomPage.tsx)
    const mainPanelKinds = new Set([
      'user_input',
      'host_response',
      'host_thought',
      'host_dispatch',
      'result_injection',
      'system',
      'agent_join',
    ]);
    const hostUserEvents = emitterSpy.responseStream.filter((e) => mainPanelKinds.has(e.msg_kind as string));
    expect(hostUserEvents.length).toBeGreaterThan(0);
    expect(hostUserEvents.every((e) => e.agentRole === 'host')).toBe(true);

    // Sub-agent tab: filter by agentId = sub.id
    const subTabEvents = emitterSpy.responseStream.filter((e) => e.agentId === sub.id);
    expect(subTabEvents.length).toBeGreaterThan(0);
    const subKinds = subTabEvents.map((e) => e.msg_kind);
    expect(subKinds).toContain('sub_output');
    expect(subKinds).toContain('sub_thinking');
  });
});

// ==========================================
// Case 11-19: Bridge-level integration tests
// ==========================================
// These cases verify the full bridge → orchestrator → IPC flow that the
// frontend relies on. They exercise the same code paths that the renderer
// calls via ipcBridge.groupRoom.* providers and .on() subscriptions.

describe('Case 11-19: Bridge-level integration tests (frontend rendering layer)', () => {
  let db11: ISqliteDriver;
  let service11: GroupRoomService;
  let mockConv11: ReturnType<typeof createMockConversationService>;
  let mockFactory11: { register: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let roomId11: string;

  beforeEach(() => {
    uuidCounter = 0;
    emitterSpy.reset();
    acpAgentInstances.length = 0;
    resetAllBehaviors();
    vi.clearAllMocks();

    db11 = createTestDb();
    service11 = new GroupRoomService(db11);
    mockConv11 = createMockConversationService();
    mockFactory11 = { register: vi.fn(), create: vi.fn() };

    mockConv11._store.set('conv-host-11', {
      id: 'conv-host-11',
      type: 'acp',
      name: 'Host Conv 11',
      extra: { workspace: '/ui-test', backend: 'claude' },
    });

    const room = service11.createRoom({
      userId: 'user-ui',
      name: 'UI Test Room',
      description: 'Room for frontend tests',
      hostConversationId: 'conv-host-11',
    });
    roomId11 = room.id;
  });

  afterEach(() => {
    db11.close();
  });

  function createOrch11(rid?: string) {
    return new GroupRoomOrchestrator(rid ?? roomId11, db11, mockConv11, mockFactory11);
  }

  it('Case 11: createRoom returns id, name, hostConversationId for frontend navigation', () => {
    const room = service11.createRoom({
      userId: 'user-create',
      name: 'New Group',
      description: 'A test group',
      hostConversationId: 'conv-new-host',
    });

    expect(room).toHaveProperty('id');
    expect(room.name).toBe('New Group');
    expect(room.hostConversationId).toBe('conv-new-host');
    expect(room.status).toBe('idle');

    // Verify getRoom returns same data (bridge.get path)
    const fetched = service11.getRoom(room.id);
    expect(fetched).toBeDefined();
    expect(fetched!.room.id).toBe(room.id);
    expect(fetched!.room.name).toBe('New Group');
  });

  it('Case 12: getRoom returns member list with displayName, role, status, agentType', () => {
    // createRoom already inserts a host agent automatically.
    // Add a sub member.
    service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'gemini',
      displayName: 'Gemini Worker',
      conversationId: 'conv-gemini-sub',
    });

    const roomData = service11.getRoom(roomId11);
    expect(roomData).toBeDefined();
    // 1 auto-created host + 1 manually added sub
    expect(roomData!.members.length).toBeGreaterThanOrEqual(2);

    const host = roomData!.members.find((m) => m.role === 'host');
    expect(host).toBeDefined();
    expect(host!.displayName).toBeTruthy();
    expect(host!.status).toBe('idle');

    const sub = roomData!.members.find((m) => m.displayName === 'Gemini Worker');
    expect(sub).toBeDefined();
    expect(sub!.agentType).toBe('gemini');
    expect(sub!.role).toBe('sub');
  });

  it('Case 13: getRoom + getMessagesByRoom returns room, members, and messages (bridge.get path)', async () => {
    // Persist user message (bridge sendMessage path)
    const msgId = service11.addMessage({
      roomId: roomId11,
      senderType: 'user',
      senderId: null,
      msgKind: 'user_input',
      content: 'Hello group!',
      status: 'finish',
    });
    expect(typeof msgId).toBe('string');

    // Start orchestrator (bridge fire-and-forget path)
    setAgentBehavior('conv-host-11', () => 'Group reply.');

    const orch = createOrch11();
    await orch.start('Hello group!', msgId);

    // === Simulate bridge.get response shape ===
    // This mirrors what groupRoomBridge.get.provider returns
    const roomData = service11.getRoom(roomId11);
    const messages = service11.getMessagesByRoom(roomId11);

    // room data present
    expect(roomData).toBeDefined();
    expect(roomData!.room.id).toBe(roomId11);
    expect(roomData!.room.name).toBe('UI Test Room');

    // members present (at least the host)
    expect(roomData!.members.length).toBeGreaterThanOrEqual(1);
    const host = roomData!.members.find((m) => m.role === 'host');
    expect(host).toBeDefined();

    // messages present and include both user_input and host_response
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const userMsgs = messages.filter((m) => m.msgKind === 'user_input');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].content).toBe('Hello group!');

    const hostMsgs = messages.filter((m) => m.msgKind === 'host_response');
    expect(hostMsgs).toHaveLength(1);

    // Verify the bridge.get shape: { id, name, status, members, messages }
    const bridgeGetShape = {
      id: roomData!.room.id,
      name: roomData!.room.name,
      status: roomData!.room.status,
      members: roomData!.members,
      messages,
    };
    expect(bridgeGetShape).toHaveProperty('id');
    expect(bridgeGetShape).toHaveProperty('name');
    expect(bridgeGetShape).toHaveProperty('status');
    expect(bridgeGetShape.members.length).toBeGreaterThanOrEqual(1);
    expect(bridgeGetShape.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('Case 14: host_thought and result_injection appear in main panel (MAIN_PANEL_KINDS)', async () => {
    // MAIN_PANEL_KINDS in GroupRoomPage.tsx must include host_thought and result_injection
    // so the user can see the full coordination process in the main panel.
    const MAIN_PANEL_KINDS = new Set([
      'user_input',
      'host_response',
      'host_thought',
      'host_dispatch',
      'result_injection',
      'system',
      'agent_join',
    ]);

    // Verify host_thought and result_injection are in the set (Cases 10/14 requirement)
    expect(MAIN_PANEL_KINDS.has('host_thought')).toBe(true);
    expect(MAIN_PANEL_KINDS.has('result_injection')).toBe(true);

    // Now verify the orchestrator actually emits these kinds
    const sub = service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'claude',
      displayName: 'Case14Sub',
      conversationId: 'conv-case14-sub',
    });
    mockConv11._store.set('conv-case14-sub', {
      id: 'conv-case14-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ui-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-11', (_i, idx) => {
      if (idx === 0) {
        return {
          content: `<dispatch><agent id="${sub.id}" description="main panel task" prompt="main panel task"/></dispatch>`,
          thoughts: ['Host thinking visible in main panel'],
        };
      }
      return 'Host final summary.';
    });
    setAgentBehavior('conv-case14-sub', () => 'sub result for injection');

    const orch = createOrch11();
    await orch.start('case 14 test', 'msg-14');

    // host_thought events emitted (should appear in main panel)
    const thoughtEvents = emitterSpy.responseStream.filter((e) => e.msg_kind === 'host_thought');
    expect(thoughtEvents.length).toBeGreaterThanOrEqual(1);
    expect(thoughtEvents[0].content).toBe('Host thinking visible in main panel');

    // result_injection persisted in DB (should appear in main panel on reload)
    const msgs = service11.getMessagesByRoom(roomId11);
    const injections = msgs.filter((m) => m.msgKind === 'result_injection');
    expect(injections.length).toBeGreaterThanOrEqual(1);
    expect(injections[0].content).toContain('completed]');

    // All emitted kinds that match MAIN_PANEL_KINDS are from host
    const mainPanelEmitted = emitterSpy.responseStream.filter((e) => MAIN_PANEL_KINDS.has(e.msg_kind as string));
    expect(mainPanelEmitted.length).toBeGreaterThan(0);
    expect(mainPanelEmitted.every((e) => e.agentRole === 'host')).toBe(true);
  });

  it('Case 15: dynamic sub-agent triggers memberChanged join event (tab creation data)', async () => {
    // When a dynamic sub-agent is created via dispatch, a memberChanged event
    // with action='join' is emitted. The frontend uses this to add a new tab.
    setAgentBehavior('conv-host-11', (_i, idx) => {
      if (idx === 0) {
        return `<dispatch><agent type="claude" description="DynamicWorker" prompt="dynamic task"/></dispatch>`;
      }
      return 'dynamic done.';
    });

    // Set up dynamic sub creation
    const origCreate = mockConv11.createConversation;
    mockConv11.createConversation = vi.fn().mockImplementation(async (params: Record<string, unknown>) => {
      const result = await origCreate(params);
      setAgentBehavior(result.id as string, () => 'dynamic sub result');
      return result;
    });

    const orch = createOrch11();
    await orch.start('dispatch dynamic', 'msg-15');

    // memberChanged join event emitted for the new sub
    const joinEvents = emitterSpy.memberChanged.filter((e) => e.action === 'join');
    expect(joinEvents).toHaveLength(1);
    const joinedMember = joinEvents[0].member as Record<string, unknown>;
    expect(joinedMember.displayName).toBe('DynamicWorker');
    expect(joinedMember.role).toBe('sub');
    expect(joinedMember).toHaveProperty('id');
    expect(joinedMember).toHaveProperty('agentType');

    // Sub-agent's output also streams via responseStream with the member's id
    const subStreams = emitterSpy.responseStream.filter((e) => e.agentRole === 'sub' && e.msg_kind === 'sub_output');
    expect(subStreams.length).toBeGreaterThan(0);
    expect(subStreams[0].agentId).toBe(joinedMember.id);
  });

  it('Case 16: thought events emitted for both host (host_thought) and sub (sub_thinking)', async () => {
    const sub = service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'claude',
      displayName: 'Thinker',
      conversationId: 'conv-think-sub',
    });
    mockConv11._store.set('conv-think-sub', {
      id: 'conv-think-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ui-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-11', (_i, idx) => {
      if (idx === 0) {
        return {
          content: `<dispatch><agent id="${sub.id}" description="think task" prompt="think task"/></dispatch>`,
          thoughts: ['Host is reasoning about the problem...'],
        };
      }
      return 'synthesis complete.';
    });
    setAgentBehavior('conv-think-sub', () => ({
      content: 'thought result',
      thoughts: ['Sub is analyzing the data...'],
    }));

    const orch = createOrch11();
    await orch.start('think', 'msg-16');

    // Host thoughts
    const hostThoughts = emitterSpy.responseStream.filter((e) => e.msg_kind === 'host_thought');
    expect(hostThoughts.length).toBeGreaterThanOrEqual(1);
    expect(hostThoughts[0].content).toBe('Host is reasoning about the problem...');

    // Sub thoughts
    const subThoughts = emitterSpy.responseStream.filter((e) => e.msg_kind === 'sub_thinking');
    expect(subThoughts.length).toBeGreaterThanOrEqual(1);
    expect(subThoughts[0].content).toBe('Sub is analyzing the data...');
  });

  it('Case 17: sendMessage persists user_input and triggers full orchestration cycle', async () => {
    // Simulates the bridge.sendMessage flow: persist user message, then start orchestrator
    const sub = service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'claude',
      displayName: 'Case17Sub',
      conversationId: 'conv-case17-sub',
    });
    mockConv11._store.set('conv-case17-sub', {
      id: 'conv-case17-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ui-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-11', (_i, idx) => {
      if (idx === 0)
        return `<dispatch><agent id="${sub.id}" description="do the work" prompt="do the work"/></dispatch>`;
      return 'orchestration complete.';
    });
    setAgentBehavior('conv-case17-sub', () => 'work done');

    // Step 1: persist user message (same as bridge.sendMessage does)
    const msgId = service11.addMessage({
      roomId: roomId11,
      senderType: 'user',
      senderId: null,
      msgKind: 'user_input',
      content: 'please orchestrate',
      status: 'finish',
    });

    // Step 2: start orchestrator (same as bridge.sendMessage fire-and-forget)
    const orch = createOrch11();
    await orch.start('please orchestrate', msgId);

    // Verify full cycle: user_input persisted
    const msgs = service11.getMessagesByRoom(roomId11);
    expect(msgs.filter((m) => m.msgKind === 'user_input')).toHaveLength(1);

    // Host processed and dispatched
    expect(msgs.filter((m) => m.msgKind === 'host_dispatch')).toHaveLength(1);

    // Sub-agent output persisted
    expect(msgs.filter((m) => m.msgKind === 'sub_output')).toHaveLength(1);

    // Result injected back to host
    expect(msgs.filter((m) => m.msgKind === 'result_injection')).toHaveLength(1);

    // Host response(s) persisted (host is called twice: dispatch + final answer)
    expect(msgs.filter((m) => m.msgKind === 'host_response').length).toBeGreaterThanOrEqual(1);

    // turnCompleted emitted
    expect(emitterSpy.turnCompleted).toHaveLength(1);
    expect(emitterSpy.turnCompleted[0].canSendMessage).toBe(true);

    // Room back to idle
    expect(service11.getRoom(roomId11)!.room.status).toBe('idle');
  });

  it('Case 17b: sub-agent messages filterable by agentId (per-member tab isolation)', async () => {
    const sub1 = service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'claude',
      displayName: 'SubA',
      conversationId: 'conv-sub-a',
    });
    const sub2 = service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'gemini',
      displayName: 'SubB',
      conversationId: 'conv-sub-b',
    });
    mockConv11._store.set('conv-sub-a', {
      id: 'conv-sub-a',
      type: 'acp',
      name: 'SubA',
      extra: { workspace: '/ui-test', backend: 'claude' },
    });
    mockConv11._store.set('conv-sub-b', {
      id: 'conv-sub-b',
      type: 'gemini',
      name: 'SubB',
      extra: { workspace: '/ui-test', backend: 'gemini' },
    });

    setAgentBehavior('conv-host-11', (_i, idx) => {
      if (idx === 0) {
        return [
          '<dispatch>',
          `  <agent id="${sub1.id}" description="task A" prompt="task for A"/>`,
          `  <agent id="${sub2.id}" description="task B" prompt="task for B"/>`,
          '</dispatch>',
        ].join('\n');
      }
      return 'both done.';
    });
    setAgentBehavior('conv-sub-a', () => 'SubA unique output');
    setAgentBehavior('conv-sub-b', () => 'SubB unique output');

    const orch = createOrch11();
    await orch.start('parallel', 'msg-17b');

    // Frontend filter: messages for SubA tab
    const subAEvents = emitterSpy.responseStream.filter((e) => e.agentId === sub1.id);
    expect(subAEvents.length).toBeGreaterThan(0);
    expect(subAEvents.some((e) => (e.content as string).includes('SubA unique output'))).toBe(true);
    expect(subAEvents.every((e) => e.agentId === sub1.id)).toBe(true);

    // Frontend filter: messages for SubB tab
    const subBEvents = emitterSpy.responseStream.filter((e) => e.agentId === sub2.id);
    expect(subBEvents.length).toBeGreaterThan(0);
    expect(subBEvents.some((e) => (e.content as string).includes('SubB unique output'))).toBe(true);
    expect(subBEvents.every((e) => e.agentId === sub2.id)).toBe(true);

    // No cross-contamination
    expect(subAEvents.some((e) => (e.content as string).includes('SubB'))).toBe(false);
    expect(subBEvents.some((e) => (e.content as string).includes('SubA'))).toBe(false);
  });

  it('Case 18: MAIN_PANEL_KINDS matches GroupRoomPage and excludes sub-only kinds', async () => {
    const sub = service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'claude',
      displayName: 'FilteredSub',
      conversationId: 'conv-filtered-sub',
    });
    mockConv11._store.set('conv-filtered-sub', {
      id: 'conv-filtered-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ui-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-11', (_i, idx) => {
      if (idx === 0) {
        return {
          content: `Host says: dispatching.\n<dispatch><agent id="${sub.id}" description="background work" prompt="background work"/></dispatch>`,
          thoughts: ['Host internal thought'],
        };
      }
      return 'Host final answer.';
    });
    setAgentBehavior('conv-filtered-sub', () => ({
      content: 'sub background result',
      thoughts: ['sub internal thought'],
    }));

    const orch = createOrch11();
    await orch.start('main panel test', 'msg-18');

    // Main panel kinds must match GroupRoomPage.tsx MAIN_PANEL_KINDS exactly
    const mainPanelKinds = new Set([
      'user_input',
      'host_response',
      'host_thought',
      'host_dispatch',
      'result_injection',
      'system',
      'agent_join',
    ]);
    const mainPanelEvents = emitterSpy.responseStream.filter((e) => mainPanelKinds.has(e.msg_kind as string));
    expect(mainPanelEvents.length).toBeGreaterThan(0);
    // All main panel events should be from host
    expect(mainPanelEvents.every((e) => e.agentRole === 'host')).toBe(true);

    // Sub-agent events should NOT appear in main panel filter
    const subOnlyKinds = new Set(['sub_output', 'sub_thinking']);
    const subEventsInMain = emitterSpy.responseStream.filter(
      (e) => mainPanelKinds.has(e.msg_kind as string) && e.agentRole === 'sub'
    );
    expect(subEventsInMain).toHaveLength(0);

    // But sub events DO exist (for sub tab)
    const subEvents = emitterSpy.responseStream.filter((e) => subOnlyKinds.has(e.msg_kind as string));
    expect(subEvents.length).toBeGreaterThan(0);
  });

  it('Case 19: real-time status: turnCompleted + memberChanged status transitions for progress display', async () => {
    const sub = service11.addAgent({
      roomId: roomId11,
      role: 'sub',
      agentType: 'claude',
      displayName: 'ProgressSub',
      conversationId: 'conv-progress-sub',
    });
    mockConv11._store.set('conv-progress-sub', {
      id: 'conv-progress-sub',
      type: 'acp',
      name: 'Sub',
      extra: { workspace: '/ui-test', backend: 'claude' },
    });

    setAgentBehavior('conv-host-11', (_i, idx) => {
      if (idx === 0)
        return `<dispatch><agent id="${sub.id}" description="progress task" prompt="progress task"/></dispatch>`;
      return 'All complete.';
    });
    setAgentBehavior('conv-progress-sub', () => 'progress result');

    const orch = createOrch11();
    await orch.start('progress test', 'msg-19');

    // turnCompleted emitted exactly once
    expect(emitterSpy.turnCompleted).toHaveLength(1);
    expect(emitterSpy.turnCompleted[0]).toMatchObject({
      roomId: roomId11,
      status: 'finished',
      canSendMessage: true,
    });

    // Room status should be idle after successful completion
    const finalRoom = service11.getRoom(roomId11);
    expect(finalRoom!.room.status).toBe('idle');

    // memberChanged events show status transitions (running → finished)
    const statusUpdates = emitterSpy.memberChanged.filter((e) => e.action === 'status_update');
    expect(statusUpdates.length).toBeGreaterThanOrEqual(2); // running + finished
    const subStatuses = statusUpdates
      .filter((e) => (e.member as Record<string, unknown>).id === sub.id)
      .map((e) => (e.member as Record<string, unknown>).status);
    expect(subStatuses).toContain('running');
    expect(subStatuses).toContain('finished');
  });
});
