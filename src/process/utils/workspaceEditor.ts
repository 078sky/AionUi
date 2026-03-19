/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getWorkspaceEditorLabel, type WorkspaceEditorTarget } from '@/common/workspaceEditor';
import { shell } from 'electron';
import { getEnhancedEnv } from './shellEnv';
import { safeExec, safeExecFile } from './safeExec';

type WorkspaceEditorDefinition = {
  label: string;
  commandCandidates: string[];
  darwinAppNames: string[];
  windowsExecutableNames: string[];
  windowsDisplayNames: string[];
  windowsPathCandidates: string[];
  protocolSchemes: string[];
};

const REGISTRY_QUERY_TIMEOUT_MS = 2500;
const WINDOWS_APP_PATH_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
] as const;
const WINDOWS_UNINSTALL_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
] as const;

const WORKSPACE_EDITOR_DEFINITIONS: Record<Exclude<WorkspaceEditorTarget, 'explorer'>, WorkspaceEditorDefinition> = {
  vscode: {
    label: 'VS Code',
    commandCandidates: ['code', 'code.cmd', 'code-insiders', 'code-insiders.cmd'],
    darwinAppNames: ['Visual Studio Code', 'Visual Studio Code - Insiders'],
    windowsExecutableNames: ['Code.exe'],
    windowsDisplayNames: ['Microsoft Visual Studio Code (User)', 'Microsoft Visual Studio Code'],
    windowsPathCandidates: [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
    ],
    protocolSchemes: ['vscode'],
  },
  cursor: {
    label: 'Cursor',
    commandCandidates: ['cursor', 'cursor.cmd'],
    darwinAppNames: ['Cursor'],
    windowsExecutableNames: ['Cursor.exe'],
    windowsDisplayNames: ['Cursor (User)', 'Cursor'],
    windowsPathCandidates: [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe')],
    protocolSchemes: ['cursor'],
  },
  trae: {
    label: 'Trae',
    commandCandidates: ['trae', 'trae.cmd'],
    darwinAppNames: ['Trae'],
    windowsExecutableNames: ['Trae.exe'],
    windowsDisplayNames: ['Trae (User)', 'Trae'],
    windowsPathCandidates: [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Trae', 'Trae.exe')],
    protocolSchemes: ['trae'],
  },
  trae_cn: {
    label: 'Trae CN',
    commandCandidates: ['trae-cn', 'trae_cn', 'trae-cn.cmd', 'trae_cn.cmd'],
    darwinAppNames: ['Trae CN', 'TraeCN'],
    windowsExecutableNames: ['Trae CN.exe', 'TraeCN.exe'],
    windowsDisplayNames: ['Trae CN (User)', 'Trae CN'],
    windowsPathCandidates: [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Trae CN', 'Trae CN.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TraeCN', 'TraeCN.exe'),
    ],
    protocolSchemes: ['trae-cn', 'trae_cn'],
  },
};

const registryValueCache = new Map<string, string | null>();
const registryKeySearchCache = new Map<string, string | null>();

const unique = (items: Array<string | null | undefined>): string[] =>
  Array.from(new Set(items.filter((item): item is string => Boolean(item && item.trim()))));

const fileExists = (targetPath: string): boolean => {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
};

const normalizeRegistryValue = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutIndex = trimmed.replace(/,\d+\s*$/, '');
  const quotedMatch = withoutIndex.match(/^"([^"]+)"/);
  const candidate = quotedMatch ? quotedMatch[1] : withoutIndex.split(/\s+\/|\s+-/)[0];
  return candidate.trim() || null;
};

const buildEditorProtocolUrls = (schemes: string[], workspace: string): string[] => {
  const normalizedPath = workspace.replace(/\\/g, '/');
  const encodedPath = encodeURI(normalizedPath);
  return schemes.map((scheme) => `${scheme}://file/${encodedPath}`);
};

const parseRegistryValue = (output: string, valueName: string): string | null => {
  const normalizedValueName = valueName === '(Default)' ? '' : valueName;
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (valueName === '(Default)') {
      const match = trimmed.match(/^REG_\w+\s+(.+)$/);
      if (match?.[1]) return match[1].trim();
      continue;
    }

    if (!trimmed.startsWith(normalizedValueName)) continue;
    const parts = trimmed.split(/\s{2,}/).filter(Boolean);
    if (parts.length >= 3) {
      return parts.slice(2).join(' ').trim();
    }
  }

  return null;
};

const queryRegistryValue = async (key: string, valueName: string): Promise<string | null> => {
  const cacheKey = `${key}::${valueName}`;
  if (registryValueCache.has(cacheKey)) {
    return registryValueCache.get(cacheKey) ?? null;
  }

  try {
    const args = valueName === '(Default)' ? ['query', key, '/ve'] : ['query', key, '/v', valueName];
    const { stdout } = await safeExecFile('reg', args, {
      timeout: REGISTRY_QUERY_TIMEOUT_MS,
      env: getEnhancedEnv(),
    });
    const result = parseRegistryValue(stdout, valueName);
    registryValueCache.set(cacheKey, result);
    return result;
  } catch {
    registryValueCache.set(cacheKey, null);
    return null;
  }
};

const findRegistryKeyByDisplayName = async (displayName: string): Promise<string | null> => {
  const cacheKey = `displayName::${displayName}`;
  if (registryKeySearchCache.has(cacheKey)) {
    return registryKeySearchCache.get(cacheKey) ?? null;
  }

  for (const root of WINDOWS_UNINSTALL_ROOTS) {
    try {
      const { stdout } = await safeExecFile('reg', ['query', root, '/s', '/f', displayName, '/d'], {
        timeout: REGISTRY_QUERY_TIMEOUT_MS,
        env: getEnhancedEnv(),
      });
      const keyLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('HKEY_'));
      if (keyLine) {
        registryKeySearchCache.set(cacheKey, keyLine);
        return keyLine;
      }
    } catch {
      // Continue searching remaining roots.
    }
  }

  registryKeySearchCache.set(cacheKey, null);
  return null;
};

const findWindowsEditorExecutable = async (definition: WorkspaceEditorDefinition): Promise<string | null> => {
  for (const executableName of definition.windowsExecutableNames) {
    for (const root of WINDOWS_APP_PATH_ROOTS) {
      const key = `${root}\\${executableName}`;
      const directPath = normalizeRegistryValue(await queryRegistryValue(key, '(Default)'));
      if (directPath && fileExists(directPath)) {
        return directPath;
      }
    }
  }

  for (const displayName of definition.windowsDisplayNames) {
    const registryKey = await findRegistryKeyByDisplayName(displayName);
    if (!registryKey) continue;

    const displayIcon = normalizeRegistryValue(await queryRegistryValue(registryKey, 'DisplayIcon'));
    if (displayIcon && fileExists(displayIcon)) {
      return displayIcon;
    }

    const installLocation = normalizeRegistryValue(await queryRegistryValue(registryKey, 'InstallLocation'));
    if (!installLocation) continue;

    for (const executableName of definition.windowsExecutableNames) {
      const installExecutable = path.join(installLocation, executableName);
      if (fileExists(installExecutable)) {
        return installExecutable;
      }
    }
  }

  for (const candidate of definition.windowsPathCandidates) {
    if (candidate && fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
};

const spawnDetached = async (command: string, args: string[], cwd: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: getEnhancedEnv(),
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
};

const tryLaunchCommand = async (command: string, workspace: string): Promise<boolean> => {
  try {
    await spawnDetached(command, [workspace], workspace);
    return true;
  } catch {
    if (process.platform === 'win32') {
      try {
        const escapedCommand = command.replace(/"/g, '""');
        const escapedWorkspace = workspace.replace(/"/g, '""');
        await safeExec(`start "" "${escapedCommand}" "${escapedWorkspace}"`, {
          timeout: 5000,
          env: getEnhancedEnv(),
        });
        return true;
      } catch {
        // Continue trying remaining command candidates.
      }
    }

    return false;
  }
};

const tryLaunchDarwinApp = async (appName: string, workspace: string): Promise<boolean> => {
  try {
    await spawnDetached('open', ['-a', appName, workspace], workspace);
    return true;
  } catch {
    return false;
  }
};

export async function openWorkspaceInEditor(target: WorkspaceEditorTarget, workspace: string): Promise<void> {
  if (!workspace?.trim()) {
    throw new Error('Workspace path is required');
  }

  if (!fileExists(workspace)) {
    throw new Error(`Workspace path does not exist: ${workspace}`);
  }

  if (target === 'explorer') {
    const errorMessage = await shell.openPath(workspace);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return;
  }

  const definition = WORKSPACE_EDITOR_DEFINITIONS[target];
  const commandCandidates = [...definition.commandCandidates];

  if (process.platform === 'win32') {
    const windowsExecutable = await findWindowsEditorExecutable(definition);
    if (windowsExecutable) {
      commandCandidates.unshift(windowsExecutable);
    }
  }

  for (const commandCandidate of unique(commandCandidates)) {
    if (await tryLaunchCommand(commandCandidate, workspace)) {
      return;
    }
  }

  if (process.platform === 'darwin') {
    for (const appName of unique(definition.darwinAppNames)) {
      if (await tryLaunchDarwinApp(appName, workspace)) {
        return;
      }
    }
  }

  const protocolUrls = buildEditorProtocolUrls(definition.protocolSchemes, workspace);
  for (const protocolUrl of protocolUrls) {
    try {
      await shell.openExternal(protocolUrl);
      return;
    } catch {
      // Continue trying remaining protocol URLs.
    }
  }

  throw new Error(`Failed to open workspace in ${getWorkspaceEditorLabel(target)}`);
}
