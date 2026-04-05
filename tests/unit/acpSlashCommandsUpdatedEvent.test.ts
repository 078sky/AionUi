import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks that are referenced inside vi.mock factories
const { mockEmit, capturedCallbacks, createdAgents } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  capturedCallbacks: {
    onAvailableCommandsUpdate: null as
      | ((commands: Array<{ name: string; description?: string; hint?: string }>) => void)
      | null,
    onStreamEvent: null as ((message: Record<string, unknown>) => void) | null,
  },
  createdAgents: [] as Array<Record<string, unknown>>,
}));

// --- Module mocks ---

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: { isPackaged: () => false, getAppPath: () => null },
    worker: {
      fork: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        postMessage: vi.fn(),
        kill: vi.fn(),
      })),
    },
  }),
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: vi.fn(() => ({})),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { emit: mockEmit } },
    conversation: {
      confirmation: {
        add: { emit: vi.fn() },
        update: { emit: vi.fn() },
        remove: { emit: vi.fn() },
      },
      responseStream: { emit: vi.fn() },
    },
  },
}));

vi.mock('@process/channels/agent/ChannelEventBus', () => ({
  channelEventBus: { emitAgentMessage: vi.fn() },
}));

vi.mock('@process/services/database', () => ({
  getDatabase: vi.fn(async () => ({ updateConversation: vi.fn() })),
}));

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: vi.fn(async () => null), set: vi.fn(async () => {}) },
}));

vi.mock('@process/utils/message', () => ({
  addMessage: vi.fn(),
  addOrUpdateMessage: vi.fn(),
  nextTickToLocalFinish: vi.fn(),
}));

vi.mock('@process/utils/previewUtils', () => ({
  handlePreviewOpenEvent: vi.fn(),
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: { setProcessing: vi.fn() },
}));

vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: vi.fn(),
  mainError: vi.fn(),
}));

vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: () => ({ getAcpAdapters: () => [] }) },
}));

vi.mock('@/common/utils', () => ({
  parseError: vi.fn((e: unknown) => String(e)),
  uuid: vi.fn(() => 'mock-uuid'),
}));

vi.mock('@process/task/MessageMiddleware', () => ({
  extractTextFromMessage: vi.fn(),
  processCronInMessage: vi.fn(),
}));

vi.mock('@process/task/ThinkTagDetector', () => ({
  stripThinkTags: vi.fn((s: string) => s),
}));

vi.mock('@process/task/CronCommandDetector', () => ({
  hasCronCommands: vi.fn(() => false),
}));

vi.mock('@process/utils/initAgent', () => ({
  hasNativeSkillSupport: vi.fn(() => true),
  setupAssistantWorkspace: vi.fn(),
}));

vi.mock('@process/task/agentUtils', () => ({
  prepareFirstMessageWithSkillsIndex: vi.fn(async (c: string) => c),
  buildSystemInstructions: vi.fn(async () => undefined),
}));

// Mock AcpAgent: capture callbacks and return a fully stubbed agent
vi.mock('@process/agent/acp', () => {
  const MockAcpAgent = vi.fn(function (this: Record<string, unknown>, config: Record<string, unknown>) {
    capturedCallbacks.onAvailableCommandsUpdate =
      config.onAvailableCommandsUpdate as typeof capturedCallbacks.onAvailableCommandsUpdate;
    capturedCallbacks.onStreamEvent = config.onStreamEvent as typeof capturedCallbacks.onStreamEvent;
    this.isConnected = true;
    this.hasActiveSession = true;
    this.sendMessage = vi.fn(async () => ({ success: true }));
    this.getModelInfo = vi.fn(() => null);
    this.getSessionState = vi.fn(() => null);
    this.authenticate = vi.fn(async () => {});
    this.start = vi.fn(async () => {
      this.isConnected = true;
      this.hasActiveSession = true;
    });
    this.stop = vi.fn();
    this.kill = vi.fn(async () => {
      this.isConnected = false;
      this.hasActiveSession = false;
    });
    this.on = vi.fn().mockReturnThis();
    createdAgents.push(this);
  });
  return { AcpAgent: MockAcpAgent };
});

import AcpAgentManager from '@process/task/AcpAgentManager';

function createManager(): InstanceType<typeof AcpAgentManager> {
  const data = {
    conversation_id: 'test-conv',
    backend: 'claude' as const,
    workspace: '/tmp/test-workspace',
  };
  // @ts-expect-error - backend type narrowing
  return new AcpAgentManager(data);
}

describe('AcpAgentManager — slash_commands_updated event', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallbacks.onAvailableCommandsUpdate = null;
    capturedCallbacks.onStreamEvent = null;
    createdAgents.length = 0;
  });

  it('emits slash_commands_updated when onAvailableCommandsUpdate fires', async () => {
    const manager = createManager();

    // initAgent is async — start it and let it create the AcpAgent
    const initPromise = manager.initAgent();

    // Wait for AcpAgent constructor to be called (happens synchronously within initAgent)
    await vi.waitFor(() => {
      expect(capturedCallbacks.onAvailableCommandsUpdate).not.toBeNull();
    });

    // Simulate the CLI sending available_commands_update
    capturedCallbacks.onAvailableCommandsUpdate!([
      { name: 'resume', description: 'Resume a conversation' },
      { name: 'loop', description: 'Run a loop' },
    ]);

    // Verify slash_commands_updated was emitted via IPC
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'slash_commands_updated',
        conversation_id: 'test-conv',
      })
    );

    // Verify commands were stored correctly
    const commands = manager.getAcpSlashCommands();
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({
      name: 'resume',
      description: 'Resume a conversation',
      kind: 'template',
      source: 'acp',
    });
    expect(commands[1]).toMatchObject({
      name: 'loop',
      description: 'Run a loop',
      kind: 'template',
      source: 'acp',
    });

    // Clean up
    await initPromise.catch(() => {});
  });

  it('still emits request_trace and start for a real turn that begins during bootstrap', async () => {
    const manager = createManager();
    void manager.initAgent();

    await vi.waitFor(() => {
      expect(capturedCallbacks.onStreamEvent).not.toBeNull();
    });

    (manager as unknown as { bootstrapping: boolean }).bootstrapping = true;

    capturedCallbacks.onStreamEvent!({
      type: 'start',
      conversation_id: 'test-conv',
      msg_id: 'turn-1',
      data: null,
    });

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'request_trace',
        conversation_id: 'test-conv',
      })
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start',
        conversation_id: 'test-conv',
        msg_id: 'turn-1',
      })
    );
  });

  it('still emits terminal ACP statuses during bootstrap', async () => {
    const manager = createManager();
    void manager.initAgent();

    await vi.waitFor(() => {
      expect(capturedCallbacks.onStreamEvent).not.toBeNull();
    });

    (manager as unknown as { bootstrapping: boolean }).bootstrapping = true;

    capturedCallbacks.onStreamEvent!({
      type: 'agent_status',
      conversation_id: 'test-conv',
      msg_id: 'status-auth-required',
      data: {
        backend: 'claude',
        status: 'auth_required',
        agentName: 'Claude',
      },
    });

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_status',
        conversation_id: 'test-conv',
        msg_id: 'status-auth-required',
        data: expect.objectContaining({
          status: 'auth_required',
        }),
      })
    );
  });

  it('keeps bootstrap connected noise suppressed until a real turn starts', async () => {
    const manager = createManager();
    void manager.initAgent();

    await vi.waitFor(() => {
      expect(capturedCallbacks.onStreamEvent).not.toBeNull();
    });

    (manager as unknown as { bootstrapping: boolean }).bootstrapping = true;

    capturedCallbacks.onStreamEvent!({
      type: 'agent_status',
      conversation_id: 'test-conv',
      msg_id: 'status-connected',
      data: {
        backend: 'claude',
        status: 'connected',
        agentName: 'Claude',
      },
    });

    expect(mockEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_status',
        msg_id: 'status-connected',
      })
    );
  });

  it('allows explicit authentication to surface session_active even after bootstrap auth_required', async () => {
    const manager = createManager();
    void manager.initAgent();

    await vi.waitFor(() => {
      expect(capturedCallbacks.onStreamEvent).not.toBeNull();
      expect(createdAgents[0]?.authenticate).toBeDefined();
    });

    createdAgents[0]!.authenticate = vi.fn(async () => {
      capturedCallbacks.onStreamEvent?.({
        type: 'agent_status',
        conversation_id: 'test-conv',
        msg_id: 'status-session-active-after-auth',
        data: {
          backend: 'claude',
          status: 'session_active',
          agentName: 'Claude',
        },
      });
    });

    (manager as unknown as { bootstrapping: boolean }).bootstrapping = true;

    const result = await manager.authenticate();

    expect(result).toEqual({ success: true });
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_status',
        conversation_id: 'test-conv',
        msg_id: 'status-session-active-after-auth',
        data: expect.objectContaining({
          status: 'session_active',
        }),
      })
    );
  });

  it('replaces a stale failed bootstrap after explicit authentication succeeds', async () => {
    const manager = createManager();
    void manager.initAgent();

    await vi.waitFor(() => {
      expect(createdAgents[0]?.authenticate).toBeDefined();
    });

    createdAgents[0]!.isConnected = true;
    createdAgents[0]!.hasActiveSession = true;
    createdAgents[0]!.authenticate = vi.fn(async () => {});

    const staleBootstrap = Promise.reject(new Error('Authentication required'));
    staleBootstrap.catch(() => {});
    (manager as unknown as { bootstrap: Promise<unknown> | undefined }).bootstrap = staleBootstrap;

    const authResult = await manager.authenticate();
    const recoveredAgent = await manager.initAgent();

    expect(authResult).toEqual({ success: true });
    expect(recoveredAgent).toBe(createdAgents[0]);
    await expect(staleBootstrap).rejects.toThrow('Authentication required');
  });

  it('deduplicates commands by name', async () => {
    const manager = createManager();
    void manager.initAgent();

    await vi.waitFor(() => {
      expect(capturedCallbacks.onAvailableCommandsUpdate).not.toBeNull();
    });

    capturedCallbacks.onAvailableCommandsUpdate!([
      { name: 'resume', description: 'First' },
      { name: 'resume', description: 'Duplicate' },
    ]);

    const commands = manager.getAcpSlashCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].description).toBe('First');
  });

  it('skips commands with empty or whitespace-only names', async () => {
    const manager = createManager();
    void manager.initAgent();

    await vi.waitFor(() => {
      expect(capturedCallbacks.onAvailableCommandsUpdate).not.toBeNull();
    });

    capturedCallbacks.onAvailableCommandsUpdate!([
      { name: '', description: 'No name' },
      { name: '  ', description: 'Whitespace name' },
      { name: 'valid', description: 'Valid command' },
    ]);

    const commands = manager.getAcpSlashCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0].name).toBe('valid');
  });

  it('rebuilds bootstrap when initAgent is called after a runtime disconnect', async () => {
    const manager = createManager();

    await manager.initAgent();

    expect(createdAgents).toHaveLength(1);
    expect(createdAgents[0]?.start).toHaveBeenCalledTimes(1);

    createdAgents[0]!.isConnected = false;
    createdAgents[0]!.hasActiveSession = false;

    const reconnectedAgent = await manager.initAgent();

    expect(createdAgents).toHaveLength(2);
    expect(createdAgents[0]?.kill).toHaveBeenCalledTimes(1);
    expect(createdAgents[1]?.start).toHaveBeenCalledTimes(1);
    expect(reconnectedAgent).toBe(createdAgents[1]);
  });

  it('reuses an in-flight bootstrap instead of killing a warmup that is still connecting', async () => {
    const manager = createManager();
    const inFlightBootstrap = new Promise<never>(() => {});
    const kill = vi.fn(async () => {});

    (manager as unknown as { bootstrapping: boolean }).bootstrapping = true;
    (manager as unknown as { bootstrap: Promise<unknown> | undefined }).bootstrap = inFlightBootstrap;
    (
      manager as unknown as {
        agent: {
          isConnected: boolean;
          hasActiveSession: boolean;
          kill: typeof kill;
        };
      }
    ).agent = {
      isConnected: false,
      hasActiveSession: false,
      kill,
    };

    const reusedBootstrap = manager.initAgent();

    expect(reusedBootstrap).toBe(inFlightBootstrap);
    expect(kill).not.toHaveBeenCalled();
    expect(createdAgents).toHaveLength(0);
  });

  it('joins an in-flight warmup bootstrap when sendMessage starts a real turn', async () => {
    const manager = createManager();
    const kill = vi.fn(async () => {});
    const send = vi.fn(async () => ({ success: true }));
    let resolveBootstrap: ((value: unknown) => void) | null = null;
    const inFlightBootstrap = new Promise<unknown>((resolve) => {
      resolveBootstrap = resolve;
    });

    (
      manager as unknown as {
        bootstrapping: boolean;
        bootstrap: Promise<unknown> | undefined;
        agent: {
          isConnected: boolean;
          hasActiveSession: boolean;
          kill: typeof kill;
          sendMessage: typeof send;
          getModelInfo: () => null;
        };
      }
    ).bootstrapping = true;
    (
      manager as unknown as {
        bootstrapping: boolean;
        bootstrap: Promise<unknown> | undefined;
        agent: {
          isConnected: boolean;
          hasActiveSession: boolean;
          kill: typeof kill;
          sendMessage: typeof send;
          getModelInfo: () => null;
        };
      }
    ).bootstrap = inFlightBootstrap;
    (
      manager as unknown as {
        bootstrapping: boolean;
        bootstrap: Promise<unknown> | undefined;
        agent: {
          isConnected: boolean;
          hasActiveSession: boolean;
          kill: typeof kill;
          sendMessage: typeof send;
          getModelInfo: () => null;
        };
      }
    ).agent = {
      isConnected: false,
      hasActiveSession: false,
      kill,
      sendMessage: send,
      getModelInfo: () => null,
    };

    const sendPromise = manager.sendMessage({
      content: 'Hello from queued warmup',
      msg_id: 'turn-1',
    });

    await Promise.resolve();

    expect(kill).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(createdAgents).toHaveLength(0);

    resolveBootstrap?.(
      (
        manager as unknown as {
          agent: {
            isConnected: boolean;
            hasActiveSession: boolean;
            kill: typeof kill;
            sendMessage: typeof send;
            getModelInfo: () => null;
          };
        }
      ).agent
    );

    await expect(sendPromise).resolves.toEqual({ success: true });
    expect(kill).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect((manager as unknown as { bootstrapping: boolean }).bootstrapping).toBe(false);
  });
});
