/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getApiClient } from '@renderer/api';

interface IBridgeResponse<D = unknown> {
  success: boolean;
  data?: D;
  msg?: string;
}

/**
 * Remove a file or directory from the workspace using the main-process bridge.
 * 调用主进程桥接接口从工作空间中移除文件或文件夹。
 */
export const removeWorkspaceEntry = (path: string) => {
  return getApiClient().request('remove-entry', { path }) as Promise<IBridgeResponse>;
};

/**
 * Rename a file or directory inside the workspace.
 * 调用主进程桥接接口重命名工作空间中的文件或文件夹。
 */
export const renameWorkspaceEntry = (path: string, newName: string) => {
  return getApiClient().request('rename-entry', { path, newName }) as Promise<IBridgeResponse<{ newPath: string }>>;
};
