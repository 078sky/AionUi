/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Application Handler
 *
 * Platform-agnostic application endpoints migrated from
 * src/process/bridge/applicationBridgeCore.ts.
 *
 * Skipped Electron-only handlers (from applicationBridge.ts):
 * - restart-app (requires app.relaunch/app.exit)
 * - open-dev-tools (requires BrowserWindow.webContents)
 * - is-dev-tools-opened (requires BrowserWindow.webContents)
 * - app.get-zoom-factor / app.set-zoom-factor (Electron zoom API)
 * - app.get-cdp-status / app.update-cdp-config (Chrome DevTools Protocol, Electron-only)
 */

import os from 'os';
import path from 'path';
import { getSystemDir, ProcessEnv } from '@server/utils/initStorage';
import { copyDirectoryRecursively } from '@server/utils';
import type { WsRouter } from '../router/WsRouter';

/**
 * Register application endpoint handlers on the WsRouter.
 * Replaces initApplicationBridgeCore() from src/process/bridge/applicationBridgeCore.ts.
 */
export function registerApplicationHandlers(router: WsRouter): void {
  // Get system directory information
  router.handle('system.info', async () => {
    return getSystemDir();
  });

  // Update system directory paths (cache & work dirs)
  router.handle('system.update-info', async ({ cacheDir, workDir }) => {
    try {
      const oldDir = getSystemDir();
      if (oldDir.cacheDir !== cacheDir) {
        await copyDirectoryRecursively(oldDir.cacheDir, cacheDir);
      }
      await ProcessEnv.set('aionui.dir', { cacheDir, workDir });
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, msg };
    }
  });

  // Resolve common filesystem paths without Electron
  router.handle('app.get-path', async ({ name }) => {
    const home = os.homedir();
    const map: Record<string, string> = {
      home,
      desktop: path.join(home, 'Desktop'),
      downloads: path.join(home, 'Downloads'),
    };
    return map[name] ?? home;
  });
}
