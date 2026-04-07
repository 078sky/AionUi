/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IPC bridge providers for project management.
 * Maps ipcBridge.project.* channels to ProjectService functions.
 */

import { ipcBridge } from '@/common';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '@process/services/ProjectService';
import { getDatabase } from '@process/services/database';

export function initProjectBridge(): void {
  ipcBridge.project.create.provider(async ({ name, description, directory }) => {
    return createProject(name, description, directory);
  });

  ipcBridge.project.list.provider(async () => {
    return listProjects();
  });

  ipcBridge.project.get.provider(async ({ id }) => {
    return getProject(id);
  });

  ipcBridge.project.update.provider(async ({ id, name, description }) => {
    await updateProject(id, { name, description });
  });

  ipcBridge.project.delete.provider(async ({ id }) => {
    await deleteProject(id);
  });

  ipcBridge.project.getConversations.provider(async ({ projectId }) => {
    const db = await getDatabase();
    return db.getProjectConversations(projectId);
  });
}
