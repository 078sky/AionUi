/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Window Controls Handlers
 *
 * Replaces initWindowControlsBridge() from src/process/bridge/windowControlsBridge.ts.
 *
 * All window control endpoints require Electron BrowserWindow APIs and cannot
 * be migrated to the standalone WsRouter:
 *   - window-controls:minimize   (BrowserWindow.minimize)
 *   - window-controls:maximize   (BrowserWindow.maximize)
 *   - window-controls:unmaximize (BrowserWindow.unmaximize)
 *   - window-controls:close      (BrowserWindow.close)
 *   - window-controls:is-maximized (BrowserWindow.isMaximized)
 *
 * The event 'window-controls:maximized-changed' also depends on BrowserWindow
 * maximize/unmaximize listeners.
 *
 * TODO: Implement non-Electron window control strategy if needed for standalone/web mode.
 */

import type { WsRouter } from '../router/WsRouter';

/**
 * Register window controls endpoint handlers on the WsRouter.
 *
 * Currently a no-op because all window control operations depend on
 * Electron's BrowserWindow API and cannot run in standalone mode.
 */
export function registerWindowControlsHandlers(_router: WsRouter): void {
  // All handlers skipped — see module JSDoc for details.
}
