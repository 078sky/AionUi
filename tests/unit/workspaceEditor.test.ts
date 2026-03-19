import { describe, expect, it } from 'vitest';

import {
  getWorkspaceEditorLabel,
  getWorkspaceEditorMenuTargets,
  shouldShowWorkspaceEditorLauncher,
} from '@/common/workspaceEditor';

describe('workspaceEditor helpers', () => {
  it('returns brand labels for known editor targets', () => {
    expect(getWorkspaceEditorLabel('vscode')).toBe('VS Code');
    expect(getWorkspaceEditorLabel('cursor')).toBe('Cursor');
    expect(getWorkspaceEditorLabel('trae')).toBe('Trae');
    expect(getWorkspaceEditorLabel('trae_cn')).toBe('Trae CN');
    expect(getWorkspaceEditorLabel('explorer')).toBe('File Explorer');
  });

  it('shows the launcher only when a custom workspace is associated', () => {
    expect(shouldShowWorkspaceEditorLauncher('E:\\code\\AionUi', true)).toBe(true);
    expect(shouldShowWorkspaceEditorLauncher('E:\\code\\AionUi', false)).toBe(false);
    expect(shouldShowWorkspaceEditorLauncher('', true)).toBe(false);
    expect(shouldShowWorkspaceEditorLauncher(undefined, true)).toBe(false);
  });

  it('lists supported editor and file manager targets in the dropdown', () => {
    expect(getWorkspaceEditorMenuTargets()).toEqual(['vscode', 'cursor', 'trae', 'trae_cn', 'explorer']);
  });
});
