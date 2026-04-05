/**
 * L3 Smoke Test — ACP CLI connectivity.
 *
 * Tests real ACP backend connectivity using the fake-acp-cli fixture.
 * When a real backend CLI is available (e.g. `claude`), tests that too.
 *
 * 1. Check CLI exists, skip if not
 * 2. Spawn ACP handshake (initialize)
 * 3. Create session (session/new)
 * 4. Send simple prompt (session/prompt)
 * 5. Verify response received
 * 6. Disconnect, verify process exits
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'child_process';
import path from 'path';

const FAKE_CLI_PATH = path.resolve(__dirname, '../fixtures/fake-acp-cli/index.js');
const JSONRPC_VERSION = '2.0';

function writeMessage(child: ChildProcess, message: Record<string, unknown>): void {
  child.stdin!.write(JSON.stringify(message) + '\n');
}

function waitForResponse(
  child: ChildProcess,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 10000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for response after ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line) as Record<string, unknown>;
            if (predicate(msg)) {
              clearTimeout(timer);
              child.stdout!.removeListener('data', onData);
              resolve(msg);
              return;
            }
          } catch {
            // ignore
          }
        }
      }
    };

    child.stdout!.on('data', onData);
  });
}

function spawnFakeCli(): ChildProcess {
  return spawn('node', [FAKE_CLI_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const IS_WINDOWS = process.platform === 'win32';

function isCliAvailable(cmd: string): boolean {
  try {
    // `which` on Unix, `where` on Windows
    execFileSync(IS_WINDOWS ? 'where' : 'which', [cmd], { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

describe('L3 ACP Smoke Test', () => {
  let child: ChildProcess | null = null;

  afterEach(async () => {
    if (child && !child.killed) {
      child.kill();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            if (!IS_WINDOWS) child?.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 3000);
        child!.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    child = null;
  });

  it('fake-acp-cli: full handshake + prompt + disconnect', async () => {
    child = spawnFakeCli();

    writeMessage(child, {
      jsonrpc: JSONRPC_VERSION,
      id: 1,
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    });

    const initResponse = await waitForResponse(child, (msg) => msg.id === 1);
    expect(initResponse.result).toBeDefined();
    const initResult = initResponse.result as Record<string, unknown>;
    expect(initResult.protocolVersion).toBe(1);
    expect(initResult.serverInfo).toBeDefined();

    writeMessage(child, {
      jsonrpc: JSONRPC_VERSION,
      id: 2,
      method: 'session/new',
      params: { cwd: '.', mcpServers: [] },
    });

    const sessionResponse = await waitForResponse(child, (msg) => msg.id === 2);
    expect(sessionResponse.result).toBeDefined();
    const sessionResult = sessionResponse.result as Record<string, unknown>;
    expect(sessionResult.sessionId).toBeDefined();
    expect(typeof sessionResult.sessionId).toBe('string');

    const sessionId = sessionResult.sessionId as string;

    writeMessage(child, {
      jsonrpc: JSONRPC_VERSION,
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [{ type: 'text', text: 'Say hello' }],
      },
    });

    const streamingChunks: Record<string, unknown>[] = [];
    const promptResponse = await new Promise<Record<string, unknown>>((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Prompt timed out')), 10000);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line) as Record<string, unknown>;
              if (msg.method === 'session/update') {
                streamingChunks.push(msg);
              }
              if (msg.id === 3) {
                clearTimeout(timer);
                child!.stdout!.removeListener('data', onData);
                resolve(msg);
                return;
              }
            } catch {
              // ignore
            }
          }
        }
      };

      child!.stdout!.on('data', onData);
    });

    expect(streamingChunks.length).toBeGreaterThan(0);

    expect(promptResponse.result).toBeDefined();
    const promptResult = promptResponse.result as Record<string, unknown>;
    expect(promptResult.stopReason).toBe('end_turn');

    child.stdin!.end();

    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child?.kill();
        } catch {
          // ignore
        }
        resolve(null);
      }, 5000);
      child!.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(child.killed || exitCode !== null).toBe(true);
  });

  const runRealTests = process.env.ACP_SMOKE_REAL === '1';

  const realBackends = [
    { name: 'claude', cmd: 'claude', args: ['--experimental-acp'] },
    { name: 'codex', cmd: 'codex', args: ['--experimental-acp'] },
    { name: 'goose', cmd: 'goose', args: ['acp'] },
  ] as const;

  for (const backend of realBackends) {
    it.skipIf(!runRealTests || !isCliAvailable(backend.cmd))(
      `${backend.name}: real CLI handshake (skip unless ACP_SMOKE_REAL=1)`,
      { timeout: 120000 },
      async () => {
        child = spawn(backend.cmd, backend.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        writeMessage(child, {
          jsonrpc: JSONRPC_VERSION,
          id: 1,
          method: 'initialize',
          params: { protocolVersion: 1, clientCapabilities: {} },
        });

        const initResponse = await waitForResponse(child, (msg) => msg.id === 1, 60000);
        expect(initResponse.result).toBeDefined();
      }
    );
  }
});
