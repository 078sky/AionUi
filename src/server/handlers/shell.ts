/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shell Handlers
 *
 * Replaces initShellBridgeStandalone() from src/process/bridge/shellBridgeStandalone.ts.
 * Uses Node.js child_process for cross-platform open operations (no Electron dependency).
 */

import type { WsRouter } from '../router/WsRouter';
import { execFile } from 'node:child_process';
import path from 'node:path';

function runOpen(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...rest] =
      process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', ...args]
        : process.platform === 'darwin'
          ? ['open', ...args]
          : ['xdg-open', ...args];
    execFile(cmd, rest, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Register shell endpoint handlers on the WsRouter.
 */
export function registerShellHandlers(router: WsRouter): void {
  router.handle('open-file', async (filePath) => {
    try {
      await runOpen([filePath]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to open file: ${message}`);
    }
  });

  router.handle('show-item-in-folder', async (filePath) => {
    try {
      await runOpen([path.dirname(filePath)]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to show item in folder: ${message}`);
    }
  });

  router.handle('open-external', async (url) => {
    try {
      new URL(url);
    } catch {
      console.warn(`[shell] Invalid URL passed to open-external: ${url}`);
      return;
    }
    try {
      await runOpen([url]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to open external URL: ${message}`);
    }
  });
}
