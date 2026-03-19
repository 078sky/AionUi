import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openPathMock = vi.fn();
const openExternalMock = vi.fn();
const existsSyncMock = vi.fn();
const safeExecFileMock = vi.fn();
const safeExecMock = vi.fn();
const getEnhancedEnvMock = vi.fn(() => ({ PATH: '/usr/bin' }));

type SpawnBehavior = 'spawn' | 'error';

const spawnBehaviorByCommand = new Map<string, SpawnBehavior>();
let spawnSuccessPattern: RegExp | null = null;

const spawnMock = vi.fn((command: string) => {
  const child = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> };
  child.unref = vi.fn();

  setImmediate(() => {
    if (spawnBehaviorByCommand.get(command) === 'spawn' || (spawnSuccessPattern && spawnSuccessPattern.test(command))) {
      child.emit('spawn');
      return;
    }

    child.emit('error', new Error(`failed: ${command}`));
  });

  return child as never;
});

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('fs', () => ({
  default: {
    existsSync: existsSyncMock,
  },
}));

vi.mock('electron', () => ({
  shell: {
    openPath: openPathMock,
    openExternal: openExternalMock,
  },
}));

vi.mock('../../src/process/utils/shellEnv', () => ({
  getEnhancedEnv: getEnhancedEnvMock,
}));

vi.mock('../../src/process/utils/safeExec', () => ({
  safeExec: safeExecMock,
  safeExecFile: safeExecFileMock,
}));

describe('openWorkspaceInEditor', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    spawnBehaviorByCommand.clear();
    spawnSuccessPattern = null;
    existsSyncMock.mockReturnValue(true);
    openPathMock.mockResolvedValue('');
    openExternalMock.mockResolvedValue(undefined);
    safeExecMock.mockResolvedValue({ stdout: '', stderr: '' });
    safeExecFileMock.mockResolvedValue({ stdout: '', stderr: '' });
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('rejects when workspace path is empty', async () => {
    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await expect(openWorkspaceInEditor('vscode', '')).rejects.toThrow('Workspace path is required');
  });

  it('rejects when workspace path does not exist', async () => {
    existsSyncMock.mockReturnValue(false);

    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await expect(openWorkspaceInEditor('cursor', '/missing/workspace')).rejects.toThrow(
      'Workspace path does not exist: /missing/workspace'
    );
  });

  it('opens the workspace in the system file explorer when target is explorer', async () => {
    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await openWorkspaceInEditor('explorer', '/workspace/demo');

    expect(openPathMock).toHaveBeenCalledWith('/workspace/demo');
  });

  it('launches the first available editor command', async () => {
    spawnBehaviorByCommand.set('cursor', 'spawn');

    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await openWorkspaceInEditor('cursor', '/workspace/demo');

    expect(spawnMock).toHaveBeenCalledWith(
      'cursor',
      ['/workspace/demo'],
      expect.objectContaining({
        cwd: '/workspace/demo',
        windowsHide: true,
        detached: true,
      })
    );
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('falls back to the editor protocol when all commands fail', async () => {
    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await openWorkspaceInEditor('trae_cn', '/workspace/demo project');

    expect(openExternalMock).toHaveBeenCalledWith('trae-cn://file//workspace/demo%20project');
  });

  it('falls back to opening the app bundle on macOS when CLI commands are unavailable', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    spawnBehaviorByCommand.set('open', 'spawn');

    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await openWorkspaceInEditor('vscode', '/workspace/demo');

    expect(spawnMock).toHaveBeenCalledWith(
      'open',
      ['-a', 'Visual Studio Code', '/workspace/demo'],
      expect.objectContaining({
        cwd: '/workspace/demo',
        windowsHide: true,
        detached: true,
      })
    );
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when every launch strategy fails', async () => {
    openExternalMock.mockRejectedValue(new Error('protocol failed'));

    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await expect(openWorkspaceInEditor('vscode', '/workspace/demo')).rejects.toThrow(
      'Failed to open workspace in VS Code'
    );
  });

  it('tries Windows registry resolution before command fallbacks', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    safeExecFileMock.mockResolvedValueOnce({
      stdout:
        '\n(Default)    REG_SZ    C:\\\\Users\\\\demo\\\\AppData\\\\Local\\\\Programs\\\\Microsoft VS Code\\\\Code.exe\n',
      stderr: '',
    });
    spawnSuccessPattern = /Code\.exe$/;

    const { openWorkspaceInEditor } = await import('../../src/process/utils/workspaceEditor');

    await openWorkspaceInEditor('vscode', 'C:\\workspace\\demo');

    expect(safeExecFileMock).toHaveBeenCalled();
    expect(spawnMock.mock.calls[0]?.[0]).toMatch(/Code\.exe$/);
    expect(spawnMock).toHaveBeenCalledWith(
      expect.stringMatching(/Code\.exe$/),
      ['C:\\workspace\\demo'],
      expect.objectContaining({ cwd: 'C:\\workspace\\demo' })
    );
  });
});
