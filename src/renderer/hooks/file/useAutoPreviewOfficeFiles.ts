/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useApi } from '@renderer/api';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { getFileTypeInfo } from '@/renderer/utils/file/fileType';
import { useEffect } from 'react';

/**
 * Auto-opens a preview tab when a new .pptx/.docx/.xlsx file appears in the
 * workspace directory while this component is mounted (i.e. while the user is
 * watching the current conversation).
 *
 * Delegates detection to the main process via workspaceOfficeWatch IPC:
 * - On mount: starts a fs.watch on the workspace directory.
 * - Main process emits `fileAdded` only for office files that did not exist
 *   before the watcher started (new files, not pre-existing ones).
 * - On unmount (conversation switch / close): stops the watcher, so returning
 *   to an old conversation never replays past events.
 */
export const useAutoPreviewOfficeFiles = (workspace: string | undefined) => {
  const api = useApi();
  const { findPreviewTab, openPreview } = usePreviewContext();

  useEffect(() => {
    if (!workspace) return;

    api.request('workspace-office-watch-start', { workspace }).catch(() => {});

    const unsub = api.on('workspace-office-file-added', ({ filePath, workspace: ws }) => {
      if (ws !== workspace) return;

      const { contentType } = getFileTypeInfo(filePath);
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

      if (!findPreviewTab(contentType, '', { filePath, fileName })) {
        openPreview('', contentType, { filePath, fileName, title: fileName, workspace, editable: false });
      }
    });

    return () => {
      unsub();
      api.request('workspace-office-watch-stop', { workspace }).catch(() => {});
    };
  }, [workspace, findPreviewTab, openPreview]);
};
