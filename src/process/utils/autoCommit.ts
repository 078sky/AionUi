/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auto-commit utility for workspace git repos.
 *
 * Called after each agent turn completes to snapshot the workspace state.
 * Only commits if the workspace is a git repo with unstaged changes.
 * Commits are non-blocking — failures are logged but never thrown.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Git environment variables used for auto-commits */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'AionUi',
  GIT_AUTHOR_EMAIL: 'noreply@aionui.com',
  GIT_COMMITTER_NAME: 'AionUi',
  GIT_COMMITTER_EMAIL: 'noreply@aionui.com',
};

/**
 * Auto-commit all changes in a workspace after an agent turn.
 *
 * Strategy:
 * 1. Check if workspace is a git repo (skip if not)
 * 2. Stage all changes (git add -A)
 * 3. Commit with a timestamped message (skip if nothing staged)
 *
 * @param workspace - Absolute path to the workspace directory
 * @param conversationId - Conversation ID for the commit message
 */
export async function autoCommitWorkspace(workspace: string, conversationId: string): Promise<void> {
  try {
    // Check if this is a git repo
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: workspace });
  } catch {
    // Not a git repo — nothing to commit
    return;
  }

  try {
    // Stage all changes (new, modified, deleted)
    await execFileAsync('git', ['add', '-A'], { cwd: workspace });

    // Check if there are staged changes before committing
    const { stdout: diff } = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: workspace });
    if (!diff.trim()) {
      // Nothing staged — skip commit
      return;
    }

    // Commit with a descriptive message
    const timestamp = new Date().toISOString();
    const message = `auto: turn completed [${conversationId.slice(0, 8)}] at ${timestamp}`;
    await execFileAsync('git', ['commit', '-m', message], {
      cwd: workspace,
      env: GIT_ENV,
    });
  } catch (error) {
    // Non-blocking — log and continue
    console.warn('[autoCommit] Failed to auto-commit workspace:', workspace, error);
  }
}
