/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { handleDeepLinkUrl, PROTOCOL_SCHEME } from './deepLink';

const isE2ETestMode = process.env.AIONUI_E2E_TEST === '1';

/**
 * Acquire the single-instance lock.
 * Returns true if this is the primary instance, false if another instance is already running.
 *
 * When a second instance starts (e.g. from a protocol URL), it sends its argv
 * to the first instance via the `second-instance` event, then quits.
 */
export function acquireSingleInstanceLock(): boolean {
  const deepLinkFromArgv = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
  const gotTheLock = isE2ETestMode ? true : app.requestSingleInstanceLock({ deepLinkUrl: deepLinkFromArgv });

  if (!gotTheLock) {
    console.warn('[AionUi] Another instance is already running; current process will exit.');
  }

  return gotTheLock;
}

/**
 * Register a handler for the `second-instance` event.
 * The callback receives the deep-link URL (if any) extracted from the second instance's argv.
 * The callback is responsible for focusing/recreating the main window.
 */
export function onSecondInstance(focusWindow: (deepLinkUrl?: string) => void): void {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    const deepLinkUrl =
      (additionalData as { deepLinkUrl?: string })?.deepLinkUrl ||
      argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));

    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    }

    focusWindow(deepLinkUrl);
  });
}
