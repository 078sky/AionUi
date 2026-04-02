/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Weixin Login Handlers
 *
 * Replaces initWeixinLoginBridge() from src/process/bridge/weixinLoginBridge.ts.
 *
 * The WeChat login flow depends on Electron APIs:
 *   - BrowserWindow for rendering the QR code page (WeixinLoginHandler.renderQRPage)
 *   - ipcMain.handle for the legacy 'weixin:login:start' channel
 *
 * Endpoints that cannot be migrated:
 *   - 'weixin.login-start' (requires Electron BrowserWindow for QR rendering)
 *
 * Events that cannot be emitted without Electron:
 *   - 'weixin.login-qr'
 *   - 'weixin.login-scanned'
 *   - 'weixin.login-done'
 *
 * TODO: Implement a headless WeChat login strategy that does not depend on
 * Electron BrowserWindow for QR code rendering.
 */

import type { WsRouter } from '../router/WsRouter';

/**
 * Register Weixin login endpoint handlers on the WsRouter.
 *
 * Currently a no-op because the WeChat login flow depends on
 * Electron's BrowserWindow API for QR code rendering.
 */
export function registerWeixinLoginHandlers(_router: WsRouter): void {
  // All handlers skipped — see module JSDoc for details.
}
