/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type WorkspaceEditorTarget = 'vscode' | 'cursor' | 'trae' | 'trae_cn' | 'explorer';

export const WORKSPACE_EDITOR_LABELS: Record<WorkspaceEditorTarget, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  trae: 'Trae',
  trae_cn: 'Trae CN',
  explorer: 'File Explorer',
};

export const getWorkspaceEditorLabel = (target: WorkspaceEditorTarget): string => {
  return WORKSPACE_EDITOR_LABELS[target];
};

export const shouldShowWorkspaceEditorLauncher = (workspace?: string, customWorkspace?: boolean): boolean => {
  return Boolean(workspace && customWorkspace);
};

export const getWorkspaceEditorMenuTargets = (): WorkspaceEditorTarget[] => {
  return ['vscode', 'cursor', 'trae', 'trae_cn', 'explorer'];
};
