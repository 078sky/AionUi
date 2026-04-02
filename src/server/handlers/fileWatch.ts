/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * File Watch Handler
 *
 * Manages file system watchers for individual files and workspace-level
 * office file detection. Replaces initFileWatchBridge() from
 * src/process/bridge/fileWatchBridge.ts.
 */

import type { WsRouter } from '../router/WsRouter';
import fs from 'fs';
import path from 'path';

// Store all file watchers
const watchers = new Map<string, fs.FSWatcher>();

const WORKSPACE_OFFICE_RE = /\.(pptx|docx|xlsx)$/i;

// workspace -> { watcher, emitted set }
const workspaceWatchers = new Map<string, { watcher: fs.FSWatcher; emitted: Set<string> }>();

/**
 * Register file watch and workspace office watch endpoint handlers on the WsRouter.
 * Replaces initFileWatchBridge() from src/process/bridge/fileWatchBridge.ts.
 */
export function registerFileWatchHandlers(router: WsRouter): void {
  // Start watching file
  router.handle('file-watch-start', ({ filePath }) => {
    try {
      // Stop existing watcher if any
      if (watchers.has(filePath)) {
        watchers.get(filePath)?.close();
        watchers.delete(filePath);
      }

      // Create file watcher
      const watcher = fs.watch(filePath, (eventType) => {
        // Notify renderer process on file change
        router.emit('file-changed', { filePath, eventType });
      });

      watchers.set(filePath, watcher);

      return Promise.resolve({ success: true });
    } catch (error: unknown) {
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Stop watching file
  router.handle('file-watch-stop', ({ filePath }) => {
    try {
      if (watchers.has(filePath)) {
        watchers.get(filePath)?.close();
        watchers.delete(filePath);
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: false, msg: 'No watcher found for this file' });
    } catch (error: unknown) {
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Stop all watchers
  router.handle('file-watch-stop-all', () => {
    try {
      watchers.forEach((watcher) => {
        watcher.close();
      });
      watchers.clear();
      return Promise.resolve({ success: true });
    } catch (error: unknown) {
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Watch workspace dir for new office files
  router.handle('workspace-office-watch-start', ({ workspace }) => {
    try {
      if (workspaceWatchers.has(workspace)) {
        workspaceWatchers.get(workspace)?.watcher.close();
        workspaceWatchers.delete(workspace);
      }

      const emitted = new Set<string>();

      // Note: { recursive: true } works on macOS and Windows but is not supported
      // on Linux (Node.js limitation). Only top-level files are watched there.
      const watcher = fs.watch(workspace, { recursive: true }, (eventType, filename) => {
        if (!filename || eventType !== 'rename') return;
        if (!WORKSPACE_OFFICE_RE.test(filename)) return;

        const fullPath = path.join(workspace, filename);
        if (emitted.has(fullPath)) return;

        // Only emit if the file was just created (not deleted)
        try {
          fs.accessSync(fullPath, fs.constants.F_OK);
        } catch {
          return;
        }

        emitted.add(fullPath);
        router.emit('workspace-office-file-added', { filePath: fullPath, workspace });
      });

      workspaceWatchers.set(workspace, { watcher, emitted });
      return Promise.resolve({ success: true });
    } catch (error: unknown) {
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Stop watching workspace
  router.handle('workspace-office-watch-stop', ({ workspace }) => {
    try {
      if (workspaceWatchers.has(workspace)) {
        workspaceWatchers.get(workspace)?.watcher.close();
        workspaceWatchers.delete(workspace);
      }
      return Promise.resolve({ success: true });
    } catch (error: unknown) {
      return Promise.resolve({ success: false, msg: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}
