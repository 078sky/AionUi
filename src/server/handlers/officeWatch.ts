/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Office Watch Handler (Word & Excel)
 *
 * Manages officecli watch child processes for live Word and Excel preview.
 * Each file gets one watch process on a unique port.
 * The renderer loads http://localhost:<port> in a webview.
 *
 * Replaces initOfficeWatchBridge() from src/process/bridge/officeWatchBridge.ts.
 */

import type { WsRouter } from '../router/WsRouter';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { getEnhancedEnv } from '@server/utils/shellEnv';

type OfficeDocType = 'word' | 'excel';

type StatusEmitter = (payload: { state: 'starting' | 'installing' | 'ready' | 'error'; message?: string }) => void;

type WatchSession = {
  process: ChildProcess;
  port: number;
  aborted: boolean;
};

// Track sessions by filePath — separate maps for word and excel
const wordSessions = new Map<string, WatchSession>();
const excelSessions = new Map<string, WatchSession>();

// Pending kill timers — delayed stop allows Strict Mode re-mount to reuse sessions
const wordPendingKills = new Map<string, ReturnType<typeof setTimeout>>();
const excelPendingKills = new Map<string, ReturnType<typeof setTimeout>>();

function getSessionMap(docType: OfficeDocType): Map<string, WatchSession> {
  return docType === 'word' ? wordSessions : excelSessions;
}

function getPendingKillsMap(docType: OfficeDocType): Map<string, ReturnType<typeof setTimeout>> {
  return docType === 'word' ? wordPendingKills : excelPendingKills;
}

/**
 * Find a free TCP port by binding to port 0.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to get port')));
      }
    });
    server.on('error', reject);
  });
}

/**
 * Wait until a TCP connection to localhost:port succeeds.
 */
function waitForPort(port: number, maxRetries = 150, interval = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryConnect = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        attempt++;
        if (attempt >= maxRetries) {
          reject(new Error(`Port ${port} not ready after ${maxRetries} attempts`));
        } else {
          setTimeout(tryConnect, interval);
        }
      });
    };
    tryConnect();
  });
}

/**
 * Kill an existing session and remove it from the map.
 */
function killSession(filePath: string, sessions: Map<string, WatchSession>): void {
  const session = sessions.get(filePath);
  if (session) {
    session.aborted = true;
    session.process.kill();
    sessions.delete(filePath);
  }
}

/**
 * Auto-install officecli if not found.
 */
function installOfficecli(emitStatus: StatusEmitter): boolean {
  try {
    emitStatus({ state: 'installing' });
    if (process.platform === 'win32') {
      execSync(
        'powershell -Command "irm https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.ps1 | iex"',
        { stdio: 'inherit' },
      );
    } else {
      execSync('curl -fsSL https://raw.githubusercontent.com/iOfficeAI/OfficeCli/main/install.sh | bash', {
        stdio: 'inherit',
      });
      try {
        execSync('xattr -cr ~/.local/bin/officecli && codesign -s - --force ~/.local/bin/officecli', { stdio: 'pipe' });
      } catch {
        // Ignore codesign error on non-macOS
      }
    }
    return true;
  } catch (e) {
    console.error('[officeWatch] Failed to install officecli:', e);
    return false;
  }
}

/**
 * Start an officecli watch process and wait for the server URL.
 * Reuses an existing healthy session if one is already running.
 * Auto-installs officecli on first use if not found.
 */
async function startWatch(
  filePath: string,
  docType: OfficeDocType,
  emitStatus: StatusEmitter,
  retry = false,
): Promise<string> {
  // Resolve symlinks so the pipe name matches what officecli commands compute
  try {
    filePath = fs.realpathSync(filePath);
  } catch {
    // If realpath fails, use original path
  }

  const sessions = getSessionMap(docType);
  const pendingKills = getPendingKillsMap(docType);

  // Cancel any pending delayed kill (Strict Mode re-mount)
  const pendingTimer = pendingKills.get(filePath);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingKills.delete(filePath);
  }

  // Reuse existing session if process is still alive
  const existing = sessions.get(filePath);
  if (existing && !existing.aborted && existing.process.exitCode === null) {
    const url = `http://localhost:${existing.port}`;
    return url;
  }

  // Kill any existing/pending session for this file first
  killSession(filePath, sessions);

  const port = await findFreePort();

  emitStatus({ state: 'starting' });

  const child = spawn('officecli', ['watch', filePath, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: getEnhancedEnv(),
  });

  // Track session immediately so stop can kill it
  const session: WatchSession = { process: child, port, aborted: false };
  sessions.set(filePath, session);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        killSession(filePath, sessions);
        reject(new Error('officecli watch timed out'));
      }
    }, 15000);

    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err) reject(err);
    };

    // Poll the port directly after spawn instead of parsing stdout.
    const url = `http://localhost:${port}`;
    waitForPort(port, 150, 100)
      .then(() => {
        if (session.aborted) {
          settle(new Error('Watch session was aborted'));
          return;
        }
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(url);
        }
      })
      .catch(() => {
        settle(new Error('officecli watch server did not become ready'));
        killSession(filePath, sessions);
      });

    child.stderr?.on('data', (data: Buffer) => {
      console.error(`[officeWatch] officecli stderr (${docType}):`, data.toString().trim());
    });

    child.on('error', (err) => {
      console.error(`[officeWatch] spawn error (${docType}):`, err.message);
      sessions.delete(filePath);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && !retry) {
        // officecli not found — try auto-install then retry once
        settle();
        if (installOfficecli(emitStatus)) {
          startWatch(filePath, docType, emitStatus, true).then(resolve, reject);
        } else {
          reject(new Error('officecli is not installed and auto-install failed'));
        }
      } else {
        settle(new Error(`Failed to start officecli: ${err.message}`));
      }
    });

    child.on('exit', (code, signal) => {
      sessions.delete(filePath);
      if (session.aborted) {
        settle();
        return;
      }
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      settle(new Error(`officecli exited with ${reason}`));
    });
  });
}

/**
 * Check if a port belongs to an active Word or Excel preview session.
 * Used by the web server proxy route to validate proxy targets.
 */
export function isActiveOfficeWatchPort(port: number): boolean {
  for (const [, session] of wordSessions) {
    if (session.port === port && !session.aborted && session.process.exitCode === null) {
      return true;
    }
  }
  for (const [, session] of excelSessions) {
    if (session.port === port && !session.aborted && session.process.exitCode === null) {
      return true;
    }
  }
  return false;
}

/**
 * Stop all running Word and Excel watch processes (called on app shutdown).
 */
export function stopAllOfficeWatchSessions(): void {
  for (const [filePath] of wordSessions) {
    killSession(filePath, wordSessions);
  }
  for (const [filePath] of excelSessions) {
    killSession(filePath, excelSessions);
  }
}

/**
 * Register Word and Excel preview endpoint handlers on the WsRouter.
 * Replaces initOfficeWatchBridge() from src/process/bridge/officeWatchBridge.ts.
 */
export function registerOfficeWatchHandlers(router: WsRouter): void {
  // Word preview handlers
  router.handle('word-preview.start', async ({ filePath }) => {
    try {
      const url = await startWatch(filePath, 'word', (payload) => router.emit('word-preview.status', payload));
      return { url };
    } catch (err: unknown) {
      console.error('[officeWatch] word start failed:', err);
      return { url: '', error: err instanceof Error ? err.message : String(err) };
    }
  });

  router.handle('word-preview.stop', async ({ filePath }) => {
    let resolvedPath = filePath;
    try {
      resolvedPath = fs.realpathSync(filePath);
    } catch {
      // Use original path if realpath fails
    }
    // Delay kill to allow Strict Mode re-mount to reuse the session
    const timer = setTimeout(() => {
      wordPendingKills.delete(resolvedPath);
      killSession(resolvedPath, wordSessions);
    }, 500);
    wordPendingKills.set(resolvedPath, timer);
  });

  // Excel preview handlers
  router.handle('excel-preview.start', async ({ filePath }) => {
    try {
      const url = await startWatch(filePath, 'excel', (payload) => router.emit('excel-preview.status', payload));
      return { url };
    } catch (err: unknown) {
      console.error('[officeWatch] excel start failed:', err);
      return { url: '', error: err instanceof Error ? err.message : String(err) };
    }
  });

  router.handle('excel-preview.stop', async ({ filePath }) => {
    let resolvedPath = filePath;
    try {
      resolvedPath = fs.realpathSync(filePath);
    } catch {
      // Use original path if realpath fails
    }
    // Delay kill to allow Strict Mode re-mount to reuse the session
    const timer = setTimeout(() => {
      excelPendingKills.delete(resolvedPath);
      killSession(resolvedPath, excelSessions);
    }, 500);
    excelPendingKills.set(resolvedPath, timer);
  });
}
