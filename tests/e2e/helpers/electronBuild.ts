import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

let electronBundlePrepared = false;

const resolveBunxCommand = (): string => {
  return process.platform === 'win32' ? 'bunx.cmd' : 'bunx';
};

/**
 * Ensure Electron E2E launches the current branch's out/ bundles instead of
 * whatever stale artifacts happen to exist from another branch or past run.
 */
export const ensureFreshElectronBundle = (): void => {
  if (electronBundlePrepared || process.env.AIONUI_SKIP_E2E_BUILD === '1') {
    return;
  }

  console.log('[E2E] Building current Electron bundles via electron-vite build');
  execFileSync(resolveBunxCommand(), ['electron-vite', 'build'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      AIONUI_DISABLE_AUTO_UPDATE: '1',
    },
  });
  electronBundlePrepared = true;
};
