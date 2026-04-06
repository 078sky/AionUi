/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ProjectService — manages project lifecycle (create, list, delete).
 *
 * A project is a named workspace directory that multiple conversations can
 * share. Each project directory is auto-initialized as a git repository so
 * that WorkspaceSnapshotService can operate in native git-repo mode.
 *
 * Security: all workspace paths are validated to be within the data root
 * directory. Path traversal (../) is rejected.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { uuid } from '@/common/utils';
import { getDatabase } from '@process/services/database';
import { getSystemDir } from '@process/utils/initStorage';
import type { IProjectRow } from '@process/services/database/types';

const execFileAsync = promisify(execFile);

/** Subdirectory under workDir where project directories are stored */
const PROJECTS_DIR = 'projects';

/** Subdirectory under workDir where standalone chat directories are stored */
const CHATS_DIR = 'chats';

/**
 * Resolve the root directory for projects or chats within the data path.
 * Creates the directory if it doesn't exist.
 */
async function ensureSubDir(subdir: string): Promise<string> {
  const root = path.join(getSystemDir().workDir, subdir);
  await fs.mkdir(root, { recursive: true });
  return root;
}

/**
 * Validate that a resolved path is within the allowed data root.
 * Prevents directory traversal attacks (e.g. ../../etc/passwd).
 *
 * @throws Error if the path escapes the data root
 */
function validatePathWithinDataRoot(resolvedPath: string): void {
  const dataRoot = getSystemDir().workDir;
  const normalizedRoot = path.resolve(dataRoot);
  const normalizedPath = path.resolve(resolvedPath);

  if (!normalizedPath.startsWith(normalizedRoot + path.sep) && normalizedPath !== normalizedRoot) {
    throw new Error(`Path "${resolvedPath}" is outside the data root "${dataRoot}"`);
  }
}

/**
 * Initialize a git repository in the given directory if one doesn't exist.
 * Uses the directory name as the initial commit message.
 */
async function gitInitIfNeeded(dirPath: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dirPath });
    // Already a git repo — skip
  } catch {
    // Not a git repo — initialize
    await execFileAsync('git', ['init'], { cwd: dirPath });
    // Create an initial empty commit so HEAD exists (required by WorkspaceSnapshotService)
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'Initial commit'], {
      cwd: dirPath,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'AionUi',
        GIT_AUTHOR_EMAIL: 'noreply@aionui.com',
        GIT_COMMITTER_NAME: 'AionUi',
        GIT_COMMITTER_EMAIL: 'noreply@aionui.com',
      },
    });
  }
}

/**
 * Sanitize a project name for use as a directory name.
 * Replaces unsafe characters with hyphens and trims length.
 */
function sanitizeDirName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-. ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'unnamed-project';
}

// ─────────────────────────── Public API ───────────────────────────

/**
 * Create a new project: mkdir + git init + DB insert.
 *
 * @param name - Human-readable project name
 * @param description - Optional project description
 * @param existingDirectory - Optional path to an existing folder on disk.
 *   When provided, the project links to this folder instead of creating
 *   a new one inside the AionUi data directory.
 * @returns The created project row
 * @throws If directory doesn't exist (when linking) or name conflicts
 */
export async function createProject(
  name: string,
  description?: string,
  existingDirectory?: string,
): Promise<IProjectRow> {
  let directory: string;

  if (existingDirectory) {
    // --- Link to existing folder on disk ---
    const resolved = path.resolve(existingDirectory);
    const stat = await fs.stat(resolved).catch((): null => null);
    if (!stat?.isDirectory()) {
      throw new Error(`Directory does not exist: "${resolved}"`);
    }
    directory = resolved;
  } else {
    // --- Create new folder inside data root ---
    const projectsRoot = await ensureSubDir(PROJECTS_DIR);
    const dirName = sanitizeDirName(name);
    directory = path.join(projectsRoot, dirName);

    validatePathWithinDataRoot(directory);

    // Check if directory already exists (name conflict)
    try {
      await fs.stat(directory);
      throw new Error(`Project directory "${dirName}" already exists`);
    } catch (err: unknown) {
      // ENOENT = directory doesn't exist = good, we can create it
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    await fs.mkdir(directory, { recursive: true });
  }

  // Git init if not already a repo
  await gitInitIfNeeded(directory);

  // Insert into database
  const now = Date.now();
  const db = await getDatabase();
  const project: IProjectRow = {
    id: uuid(),
    user_id: db.getSystemUser()?.id || 'system_default_user',
    name,
    directory,
    description,
    created_at: now,
    updated_at: now,
  };

  const result = db.createProject(project);
  if (!result.success) {
    // Rollback: only remove directory if we created it (not user-provided)
    if (!existingDirectory) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
    throw new Error(`Failed to create project in database: ${result.error}`);
  }

  return project;
}

/**
 * List all projects for the current user, ordered by most recent first.
 */
export async function listProjects(): Promise<IProjectRow[]> {
  const db = await getDatabase();
  return db.getUserProjects();
}

/**
 * Get a single project by ID.
 *
 * @returns The project row, or null if not found
 */
export async function getProject(projectId: string): Promise<IProjectRow | null> {
  const db = await getDatabase();
  const result = db.getProject(projectId);
  return result.success ? (result.data ?? null) : null;
}

/**
 * Update a project's name or description.
 */
export async function updateProject(
  projectId: string,
  updates: { name?: string; description?: string }
): Promise<void> {
  const db = await getDatabase();
  const result = db.updateProject(projectId, updates);
  if (!result.success) {
    throw new Error(`Failed to update project: ${result.error}`);
  }
}

/**
 * Delete a project.
 * The directory is NOT removed — only the DB record is deleted.
 * Conversations linked to the project get project_id set to NULL (ON DELETE SET NULL).
 */
export async function deleteProject(projectId: string): Promise<void> {
  const db = await getDatabase();
  const result = db.deleteProject(projectId);
  if (!result.success) {
    throw new Error(`Failed to delete project: ${result.error}`);
  }
}

/**
 * Ensure a standalone chat workspace directory exists.
 * Creates /data/chats/{conversationId}/ with git init.
 *
 * @param conversationId - The conversation ID to create a workspace for
 * @returns The absolute path to the chat workspace
 */
export async function ensureChatWorkspace(conversationId: string): Promise<string> {
  const chatsRoot = await ensureSubDir(CHATS_DIR);
  const chatDir = path.join(chatsRoot, conversationId);

  validatePathWithinDataRoot(chatDir);

  await fs.mkdir(chatDir, { recursive: true });
  await gitInitIfNeeded(chatDir);

  return chatDir;
}

/**
 * Get the workspace path for a project.
 * The directory was either created inside the data root by createProject,
 * or explicitly chosen by the user via the folder picker (linked project).
 * No data-root validation is needed here — the path is already trusted.
 *
 * @throws If project not found
 */
export async function getProjectWorkspace(projectId: string): Promise<string> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return project.directory;
}
