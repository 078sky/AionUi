import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => os.tmpdir()) },
  net: { fetch: vi.fn() },
}));

vi.mock('@process/utils', () => ({ getDataPath: () => '/data' }));

import { AcpConnection } from '../../src/process/agent/acp/AcpConnection';
import { AcpAgent } from '../../src/process/agent/acp';

const FAKE_CLI_PATH = path.resolve(__dirname, '../fixtures/fake-acp-cli/index.js');
const JSONRPC_VERSION = '2.0';

type JsonRpcMessage = Record<string, unknown>;
type FakeAuthMode = 'none' | 'required';
type FakePromptMode =
  | 'default'
  | 'late_chunk_after_cancel'
  | 'exit_mid_stream'
  | 'exit_mid_stream_once'
  | 'silent_hang';
type FakeCliOptions = {
  authMode?: FakeAuthMode;
  promptMode?: FakePromptMode;
  stepDelayMs?: number;
  exitCode?: number;
  stateFile?: string;
};

type MessageWaiter = {
  predicate: (msg: JsonRpcMessage) => boolean;
  resolve: (msg: JsonRpcMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type MessageCollector = {
  waitForMessage: (predicate: (msg: JsonRpcMessage) => boolean, timeoutMs?: number) => Promise<JsonRpcMessage>;
  dispose: () => void;
};

type AgentEvent = {
  type: string;
  conversation_id: string;
  msg_id?: string;
  data: unknown;
};

type EventWaiter = {
  predicate: (event: AgentEvent) => boolean;
  resolve: (event: AgentEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type EventCollector = {
  events: AgentEvent[];
  push: (event: AgentEvent) => void;
  waitForEvent: (predicate: (event: AgentEvent) => boolean, timeoutMs?: number) => Promise<AgentEvent>;
  dispose: () => void;
};

function spawnFakeCli(options: FakeCliOptions = {}): ChildProcess {
  return spawn(process.execPath, [FAKE_CLI_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      FAKE_ACP_AUTH_MODE: options.authMode ?? 'none',
      FAKE_ACP_PROMPT_MODE: options.promptMode ?? 'default',
      ...(typeof options.stepDelayMs === 'number' ? { FAKE_ACP_STEP_DELAY_MS: String(options.stepDelayMs) } : {}),
      ...(typeof options.exitCode === 'number' ? { FAKE_ACP_EXIT_CODE: String(options.exitCode) } : {}),
      ...(options.stateFile ? { FAKE_ACP_STATE_FILE: options.stateFile } : {}),
    },
  });
}

function writeMessage(child: ChildProcess, message: JsonRpcMessage): void {
  child.stdin!.write(JSON.stringify(message) + '\n');
}

function createMessageCollector(child: ChildProcess): MessageCollector {
  let buffer = '';
  const backlog: JsonRpcMessage[] = [];
  const waiters: MessageWaiter[] = [];

  const settleWaiter = (waiter: MessageWaiter, message: JsonRpcMessage) => {
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  };

  const pushMessage = (message: JsonRpcMessage) => {
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      settleWaiter(waiter, message);
      return;
    }

    backlog.push(message);
  };

  const onData = (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        pushMessage(JSON.parse(line) as JsonRpcMessage);
      } catch {
        // Ignore malformed lines from the fake fixture.
      }
    }
  };

  child.stdout!.on('data', onData);

  return {
    waitForMessage: async (predicate, timeoutMs = 1000) => {
      const backlogIndex = backlog.findIndex((message) => predicate(message));
      if (backlogIndex >= 0) {
        return backlog.splice(backlogIndex, 1)[0];
      }

      return await new Promise<JsonRpcMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
          if (waiterIndex >= 0) {
            waiters.splice(waiterIndex, 1);
          }
          reject(new Error(`Timed out waiting for message after ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push({
          predicate,
          resolve,
          reject,
          timer,
        });
      });
    },
    dispose: () => {
      child.stdout!.removeListener('data', onData);
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Message collector disposed'));
      }
    },
  };
}

function createEventCollector(): EventCollector {
  const events: AgentEvent[] = [];
  const waiters: EventWaiter[] = [];

  const settleWaiter = (waiter: EventWaiter, event: AgentEvent) => {
    clearTimeout(waiter.timer);
    waiter.resolve(event);
  };

  return {
    events,
    push: (event) => {
      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(event));
      if (waiterIndex >= 0) {
        const [waiter] = waiters.splice(waiterIndex, 1);
        events.push(event);
        settleWaiter(waiter, event);
        return;
      }

      events.push(event);
    },
    waitForEvent: async (predicate, timeoutMs = 1000) => {
      const eventIndex = events.findIndex((event) => predicate(event));
      if (eventIndex >= 0) {
        return events[eventIndex];
      }

      return await new Promise<AgentEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
          if (waiterIndex >= 0) {
            waiters.splice(waiterIndex, 1);
          }
          reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push({
          predicate,
          resolve,
          reject,
          timer,
        });
      });
    },
    dispose: () => {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Event collector disposed'));
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFakeCliState(stateFile: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getChunkText(message: JsonRpcMessage): string | null {
  const params = isRecord(message.params) ? message.params : null;
  const update = params && isRecord(params.update) ? params.update : null;
  const content = update && isRecord(update.content) ? update.content : null;
  return typeof content?.text === 'string' ? content.text : null;
}

function getMessageSessionId(message: JsonRpcMessage): string | null {
  const params = isRecord(message.params) ? message.params : null;
  return typeof params?.sessionId === 'string' ? params.sessionId : null;
}

async function initialize(child: ChildProcess, collector: MessageCollector): Promise<JsonRpcMessage> {
  writeMessage(child, {
    jsonrpc: JSONRPC_VERSION,
    id: 1,
    method: 'initialize',
    params: { protocolVersion: 1, clientCapabilities: {} },
  });

  return await collector.waitForMessage((message) => message.id === 1);
}

async function createSession(
  child: ChildProcess,
  collector: MessageCollector,
  params: Record<string, unknown> = {}
): Promise<string> {
  writeMessage(child, {
    jsonrpc: JSONRPC_VERSION,
    id: 2,
    method: 'session/new',
    params: { cwd: '.', mcpServers: [], ...params },
  });

  const response = await collector.waitForMessage((message) => message.id === 2);
  const result = isRecord(response.result) ? response.result : null;
  if (typeof result?.sessionId !== 'string') {
    throw new Error('Expected session/new to return a sessionId');
  }

  return result.sessionId;
}

async function loadSession(
  child: ChildProcess,
  collector: MessageCollector,
  sessionId: string
): Promise<{ sessionId: string; rawResult: Record<string, unknown> | null }> {
  writeMessage(child, {
    jsonrpc: JSONRPC_VERSION,
    id: 2,
    method: 'session/load',
    params: {
      sessionId,
      cwd: '.',
      mcpServers: [],
    },
  });

  const response = await collector.waitForMessage((message) => message.id === 2);
  const result = isRecord(response.result) ? response.result : null;
  return {
    sessionId: typeof result?.sessionId === 'string' ? result.sessionId : sessionId,
    rawResult: result,
  };
}

async function promptSession(
  child: ChildProcess,
  collector: MessageCollector,
  requestId: number,
  sessionId: string,
  promptText: string
): Promise<{ chunks: string[]; result: Record<string, unknown> | null }> {
  writeMessage(child, {
    jsonrpc: JSONRPC_VERSION,
    id: requestId,
    method: 'session/prompt',
    params: {
      sessionId,
      prompt: [{ type: 'text', text: promptText }],
    },
  });

  const chunks: string[] = [];
  while (true) {
    const message = await collector.waitForMessage(
      (candidate) =>
        candidate.id === requestId ||
        (candidate.method === 'session/update' && getMessageSessionId(candidate) === sessionId),
      2_000
    );

    if (message.id === requestId) {
      return {
        chunks,
        result: isRecord(message.result) ? message.result : null,
      };
    }

    const chunkText = getChunkText(message);
    if (chunkText) {
      chunks.push(chunkText);
    }
  }
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs = 1000
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for child exit after ${timeoutMs}ms`));
    }, timeoutMs);

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe('ACP fake CLI fixture scenarios', () => {
  let child: ChildProcess | null = null;
  let connection: AcpConnection | null = null;
  let collector: MessageCollector | null = null;
  let agent: AcpAgent | null = null;

  afterEach(async () => {
    if (agent) {
      await agent.kill().catch(() => {});
      agent = null;
    }

    if (connection) {
      await connection.disconnect();
      connection = null;
    }

    collector?.dispose();
    collector = null;

    if (child && child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill();
      try {
        await waitForExit(child, 1000);
      } catch {
        // Best-effort cleanup for the fixture process.
      }
    }
    child = null;
  });

  it('late_chunk_after_cancel emits a deterministic late chunk after session/cancel', async () => {
    child = spawnFakeCli({ promptMode: 'late_chunk_after_cancel' });
    collector = createMessageCollector(child);

    await initialize(child, collector);
    const sessionId = await createSession(child, collector);

    writeMessage(child, {
      jsonrpc: JSONRPC_VERSION,
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [{ type: 'text', text: 'Say hello' }],
      },
    });

    const firstUpdate = await collector.waitForMessage((message) => message.method === 'session/update');
    expect(getChunkText(firstUpdate)).toBe('Fake respo');

    writeMessage(child, {
      jsonrpc: JSONRPC_VERSION,
      method: 'session/cancel',
      params: { sessionId },
    });

    const lateUpdate = await collector.waitForMessage(
      (message) => message.method === 'session/update' && getChunkText(message) === '[late chunk after cancel]'
    );
    expect(getChunkText(lateUpdate)).toBe('[late chunk after cancel]');

    const promptResponse = await collector.waitForMessage((message) => message.id === 3);
    const result = isRecord(promptResponse.result) ? promptResponse.result : null;
    expect(result?.stopReason).toBe('cancelled');
  });

  it('AcpConnection authenticate unblocks session/new for auth_required', async () => {
    connection = new AcpConnection();

    await connection.connect('custom', process.execPath, process.cwd(), [FAKE_CLI_PATH], {
      FAKE_ACP_AUTH_MODE: 'required',
    });

    const initResponse = connection.getInitializeResponse();
    expect(Array.isArray(initResponse?.authMethods)).toBe(true);

    await expect(connection.newSession(process.cwd())).rejects.toThrow('Authentication required');

    const authResponse = await connection.authenticate('fake-device-login');
    expect(isRecord(authResponse)).toBe(true);

    const sessionResponse = await connection.newSession(process.cwd());
    expect(typeof sessionResponse.sessionId).toBe('string');
  });

  it('AcpAgent authenticate recovers from auth_required and restores the next turn', async () => {
    const streamCollector = createEventCollector();
    const signalCollector = createEventCollector();

    agent = new AcpAgent({
      id: 'agent-auth-flow',
      backend: 'custom',
      cliPath: process.execPath,
      workingDir: process.cwd(),
      customArgs: [FAKE_CLI_PATH],
      customEnv: {
        FAKE_ACP_AUTH_MODE: 'required',
      },
      onStreamEvent: (event) => {
        streamCollector.push(event);
      },
      onSignalEvent: (event) => {
        signalCollector.push(event);
      },
    });

    await expect(agent.start()).rejects.toThrow('Authentication required');

    const authRequiredEvent = await streamCollector.waitForEvent(
      (event) => event.type === 'agent_status' && isRecord(event.data) && event.data.status === 'auth_required',
      2_000
    );
    expect(authRequiredEvent.conversation_id).toBe('agent-auth-flow');

    await expect(agent.authenticate()).resolves.toBeUndefined();

    const authenticatedEvent = await streamCollector.waitForEvent(
      (event) => event.type === 'agent_status' && isRecord(event.data) && event.data.status === 'authenticated',
      2_000
    );
    expect(authenticatedEvent.conversation_id).toBe('agent-auth-flow');

    const sessionActiveEvent = await streamCollector.waitForEvent(
      (event) => event.type === 'agent_status' && isRecord(event.data) && event.data.status === 'session_active',
      2_000
    );
    expect(sessionActiveEvent.conversation_id).toBe('agent-auth-flow');

    const sendPromise = agent.sendMessage({ content: 'Message after authenticate', msg_id: 'turn-auth' });

    await streamCollector.waitForEvent(
      (event) => event.type === 'content' && typeof event.data === 'string' && event.data.length > 0,
      2_000
    );
    await signalCollector.waitForEvent((event) => event.type === 'finish', 2_000);

    await expect(sendPromise).resolves.toEqual({ success: true, data: null });

    streamCollector.dispose();
    signalCollector.dispose();
  });

  it('silent_hang leaves the prompt without updates or final response', async () => {
    child = spawnFakeCli({ promptMode: 'silent_hang' });
    collector = createMessageCollector(child);

    await initialize(child, collector);
    const sessionId = await createSession(child, collector);

    writeMessage(child, {
      jsonrpc: JSONRPC_VERSION,
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [{ type: 'text', text: 'Hang forever' }],
      },
    });

    await expect(
      collector.waitForMessage((message) => message.id === 3 || message.method === 'session/update', 150)
    ).rejects.toThrow(/Timed out waiting for message/);
  });

  it('AcpConnection surfaces runtime disconnect when the CLI exits mid-stream', async () => {
    connection = new AcpConnection();
    const disconnectSpy = vi.fn();
    const sessionUpdateSpy = vi.fn();

    connection.onDisconnect = disconnectSpy;
    connection.onSessionUpdate = sessionUpdateSpy;

    await connection.connect('custom', process.execPath, process.cwd(), [FAKE_CLI_PATH], {
      FAKE_ACP_PROMPT_MODE: 'exit_mid_stream',
    });
    await connection.newSession(process.cwd());

    await expect(connection.sendPrompt('Say hello')).rejects.toThrow(/ACP process exited unexpectedly/);

    expect(sessionUpdateSpy).toHaveBeenCalled();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledWith(expect.objectContaining({ code: 42, signal: null }));
  });

  it('exit_mid_stream_once only disconnects the first prompt across process restarts sharing a state file', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-acp-state-'));
    const stateFile = path.join(stateDir, 'prompt-state.json');

    try {
      child = spawnFakeCli({
        promptMode: 'exit_mid_stream_once',
        stepDelayMs: 20,
        exitCode: 42,
        stateFile,
      });
      collector = createMessageCollector(child);

      await initialize(child, collector);
      const firstSessionId = await createSession(child, collector);

      writeMessage(child, {
        jsonrpc: JSONRPC_VERSION,
        id: 3,
        method: 'session/prompt',
        params: {
          sessionId: firstSessionId,
          prompt: [{ type: 'text', text: 'Disconnect once' }],
        },
      });

      const firstUpdate = await collector.waitForMessage((message) => message.method === 'session/update');
      expect(getChunkText(firstUpdate)).toBe('Fake respo');

      const firstExit = await waitForExit(child, 1000);
      expect(firstExit).toEqual({ code: 42, signal: null });

      collector.dispose();
      collector = null;
      child = null;

      child = spawnFakeCli({
        promptMode: 'exit_mid_stream_once',
        stepDelayMs: 20,
        exitCode: 42,
        stateFile,
      });
      collector = createMessageCollector(child);

      await initialize(child, collector);
      const secondSessionId = await createSession(child, collector);

      writeMessage(child, {
        jsonrpc: JSONRPC_VERSION,
        id: 4,
        method: 'session/prompt',
        params: {
          sessionId: secondSessionId,
          prompt: [{ type: 'text', text: 'Recover after retry' }],
        },
      });

      const resumedUpdate = await collector.waitForMessage((message) => message.method === 'session/update');
      expect(getChunkText(resumedUpdate)).toBe('Fake respo');

      const resumedResponse = await collector.waitForMessage((message) => message.id === 4);
      const resumedResult = isRecord(resumedResponse.result) ? resumedResponse.result : null;
      expect(resumedResult?.stopReason).toBe('end_turn');
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('resumes remembered codeword memory across process restarts when resumeSessionId is reused', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-acp-state-'));
    const stateFile = path.join(stateDir, 'resume-state.json');

    try {
      child = spawnFakeCli({
        promptMode: 'default',
        stepDelayMs: 20,
        stateFile,
      });
      collector = createMessageCollector(child);

      await initialize(child, collector);
      const firstSessionId = await createSession(child, collector);
      const rememberResponse = await promptSession(child, collector, 3, firstSessionId, 'Remember codeword: kiwi');
      expect(rememberResponse.result?.stopReason).toBe('end_turn');
      expect(rememberResponse.chunks.join('')).toContain('Remembered codeword: kiwi');

      const firstExit = await waitForExit(child, 1_000).catch(() => null);
      if (firstExit === null) {
        child.kill();
        await waitForExit(child, 1_000);
      }
      collector.dispose();
      collector = null;
      child = null;

      child = spawnFakeCli({
        promptMode: 'default',
        stepDelayMs: 20,
        stateFile,
      });
      collector = createMessageCollector(child);

      await initialize(child, collector);
      const resumedSessionId = await createSession(child, collector, { resumeSessionId: firstSessionId });
      expect(resumedSessionId).toBe(firstSessionId);

      const recallResponse = await promptSession(
        child,
        collector,
        4,
        resumedSessionId,
        'What codeword did I ask you to remember?'
      );
      expect(recallResponse.result?.stopReason).toBe('end_turn');
      expect(recallResponse.chunks.join('')).toContain('Remembered codeword is: kiwi');
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('resumes remembered codeword memory across process restarts when session/load is reused', async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-acp-state-'));
    const stateFile = path.join(stateDir, 'resume-load-state.json');

    try {
      child = spawnFakeCli({
        promptMode: 'default',
        stepDelayMs: 20,
        stateFile,
      });
      collector = createMessageCollector(child);

      await initialize(child, collector);
      const firstSessionId = await createSession(child, collector);
      const rememberResponse = await promptSession(child, collector, 3, firstSessionId, 'Remember codeword: kiwi');
      expect(rememberResponse.result?.stopReason).toBe('end_turn');
      expect(rememberResponse.chunks.join('')).toContain('Remembered codeword: kiwi');

      const firstExit = await waitForExit(child, 1_000).catch(() => null);
      if (firstExit === null) {
        child.kill();
        await waitForExit(child, 1_000);
      }
      collector.dispose();
      collector = null;
      child = null;

      child = spawnFakeCli({
        promptMode: 'default',
        stepDelayMs: 20,
        stateFile,
      });
      collector = createMessageCollector(child);

      await initialize(child, collector);
      const loadResult = await loadSession(child, collector, firstSessionId);
      expect(loadResult.sessionId).toBe(firstSessionId);
      expect(loadResult.rawResult?.sessionId).toBeUndefined();

      const recallResponse = await promptSession(
        child,
        collector,
        4,
        loadResult.sessionId,
        'What codeword did I ask you to remember?'
      );
      expect(recallResponse.result?.stopReason).toBe('end_turn');
      expect(recallResponse.chunks.join('')).toContain('Remembered codeword is: kiwi');

      const fakeState = readFakeCliState(stateFile);
      const methodCalls = Array.isArray(fakeState.methodCalls) ? fakeState.methodCalls : [];
      expect(
        methodCalls.some(
          (call) => isRecord(call) && call.method === 'session/load' && call.sessionId === firstSessionId
        )
      ).toBe(true);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('AcpAgent keeps the late cancel chunk on the wire after finish so renderer guards can catch it', async () => {
    const streamCollector = createEventCollector();
    const signalCollector = createEventCollector();
    const timeline: Array<{ channel: 'stream' | 'signal'; event: AgentEvent }> = [];

    agent = new AcpAgent({
      id: 'agent-cancel-flow',
      backend: 'custom',
      cliPath: process.execPath,
      workingDir: process.cwd(),
      customArgs: [FAKE_CLI_PATH],
      customEnv: {
        FAKE_ACP_PROMPT_MODE: 'late_chunk_after_cancel',
        FAKE_ACP_STEP_DELAY_MS: '120',
      },
      onStreamEvent: (event) => {
        streamCollector.push(event);
        timeline.push({ channel: 'stream', event });
      },
      onSignalEvent: (event) => {
        signalCollector.push(event);
        timeline.push({ channel: 'signal', event });
      },
    });

    await agent.start();

    const sendPromise = agent.sendMessage({ content: 'Say hello', msg_id: 'turn-cancel' });

    const firstContent = await streamCollector.waitForEvent(
      (event) => event.type === 'content' && typeof event.data === 'string' && event.data.length > 0
    );
    expect(firstContent.msg_id).toBeDefined();

    agent.cancelPrompt();

    await signalCollector.waitForEvent((event) => event.type === 'finish');
    const lateContent = await streamCollector.waitForEvent(
      (event) => event.type === 'content' && event.data === '[late chunk after cancel]'
    );
    expect(lateContent.data).toBe('[late chunk after cancel]');

    await expect(sendPromise).resolves.toEqual({ success: true, data: null });

    const finishIndex = timeline.findIndex(({ channel, event }) => channel === 'signal' && event.type === 'finish');
    const lateChunkIndex = timeline.findIndex(
      ({ channel, event }) =>
        channel === 'stream' && event.type === 'content' && event.data === '[late chunk after cancel]'
    );
    expect(finishIndex).toBeGreaterThanOrEqual(0);
    expect(lateChunkIndex).toBeGreaterThan(finishIndex);

    streamCollector.dispose();
    signalCollector.dispose();
  });

  it('AcpAgent surfaces disconnected status and finish when the CLI exits mid-stream', async () => {
    const streamCollector = createEventCollector();
    const signalCollector = createEventCollector();
    const timeline: Array<{ channel: 'stream' | 'signal'; event: AgentEvent }> = [];

    agent = new AcpAgent({
      id: 'agent-disconnect-flow',
      backend: 'custom',
      cliPath: process.execPath,
      workingDir: process.cwd(),
      customArgs: [FAKE_CLI_PATH],
      customEnv: {
        FAKE_ACP_PROMPT_MODE: 'exit_mid_stream',
      },
      onStreamEvent: (event) => {
        streamCollector.push(event);
        timeline.push({ channel: 'stream', event });
      },
      onSignalEvent: (event) => {
        signalCollector.push(event);
        timeline.push({ channel: 'signal', event });
      },
    });

    await agent.start();

    const sendPromise = agent.sendMessage({ content: 'Say hello', msg_id: 'turn-disconnect' });

    await streamCollector.waitForEvent(
      (event) => event.type === 'content' && typeof event.data === 'string' && event.data.length > 0
    );

    const disconnectedEvent = await streamCollector.waitForEvent(
      (event) =>
        event.type === 'agent_status' &&
        isRecord(event.data) &&
        event.data.status === 'disconnected' &&
        event.data.disconnectCode === 42
    );
    expect(disconnectedEvent.conversation_id).toBe('agent-disconnect-flow');

    await signalCollector.waitForEvent((event) => event.type === 'finish');

    const disconnectedIndex = timeline.findIndex(
      ({ channel, event }) =>
        channel === 'stream' &&
        event.type === 'agent_status' &&
        isRecord(event.data) &&
        event.data.status === 'disconnected'
    );
    const finishIndex = timeline.findIndex(({ channel, event }) => channel === 'signal' && event.type === 'finish');
    expect(disconnectedIndex).toBeGreaterThanOrEqual(0);
    expect(finishIndex).toBeGreaterThan(disconnectedIndex);

    await expect(sendPromise).resolves.toMatchObject({
      success: false,
      error: expect.objectContaining({
        message: expect.stringContaining('ACP process exited unexpectedly'),
      }),
    });

    const errorEvent = await streamCollector.waitForEvent(
      (event) =>
        event.type === 'error' &&
        typeof event.data === 'string' &&
        event.data.includes('ACP process exited unexpectedly')
    );
    expect(typeof errorEvent.data).toBe('string');

    streamCollector.dispose();
    signalCollector.dispose();
  });
});
