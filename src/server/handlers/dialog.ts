/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dialog Handlers
 *
 * Replaces initDialogBridge() from src/process/bridge/dialogBridge.ts.
 *
 * The 'show-open' endpoint requires Electron's dialog.showOpenDialog API
 * and cannot be migrated to the standalone WsRouter.
 *
 * TODO: Implement a non-Electron file picker strategy (e.g. via browser
 * File System Access API or a CLI prompt) for standalone/web mode.
 */

import type { WsRouter } from '../router/WsRouter';

/**
 * Register dialog endpoint handlers on the WsRouter.
 *
 * Currently a no-op because the file open dialog depends on
 * Electron's dialog API and cannot run in standalone mode.
 */
export function registerDialogHandlers(_router: WsRouter): void {
  // All handlers skipped — see module JSDoc for details.
}
