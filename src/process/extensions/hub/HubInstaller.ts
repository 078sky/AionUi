import { getDataPath } from '@process/utils';
import { acpDetector } from '@process/agent/acp/AcpDetector';
import { exec } from 'child_process';
import * as crypto from 'crypto';
import { net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
  EXTENSION_MANIFEST_FILE,
  getHubResourcesDir,
  getInstallTargetDir,
  HUB_REMOTE_URLS,
} from '@process/extensions/constants';
import { ExtensionRegistry } from '@process/extensions/ExtensionRegistry';
import { hubIndexManager } from '@process/extensions/hub/HubIndexManager';
import { hubStateManager } from '@process/extensions/hub/HubStateManager';

const execAsync = promisify(exec);

export class HubInstallerImpl {
  private getCacheDir(): string {
    return path.join(getDataPath(), 'cache', 'hub');
  }

  private getTempDir(): string {
    return path.join(getInstallTargetDir(), '.tmp');
  }

  public async install(name: string): Promise<void> {
    try {
      hubStateManager.setTransientState(name, 'installing');

      const extInfo = hubIndexManager.getExtension(name);
      if (!extInfo) {
        throw new Error(`Extension ${name} not found in Hub Index`);
      }

      const tempDir = path.join(this.getTempDir(), name);
      const targetDir = path.join(getInstallTargetDir(), name);

      // Clean up previous temp dir if exists
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      // Ensure directories exist
      fs.mkdirSync(this.getCacheDir(), { recursive: true });
      fs.mkdirSync(this.getTempDir(), { recursive: true });

      // Step 1: Resolve zip path — try bundled resources first, fallback to remote download
      const zipPath = await this.resolveZipPath(name, extInfo.dist.tarball, extInfo.bundled);

      // Step 2: Verify Integrity (SHA-512 SRI)
      // TODO: 各平台校验有差异，先放在一边，后续完善
      // await this.verifyIntegrity(zipPath, extInfo.dist.integrity);

      // Step 3: Extract (.zip)
      fs.mkdirSync(tempDir, { recursive: true });
      if (process.platform === 'win32') {
        await execAsync(`tar -xf "${zipPath}" -C "${tempDir}"`);
      } else {
        await execAsync(`unzip -o "${zipPath}" -d "${tempDir}"`);
      }

      // If the archive wraps contents in a "package" directory, move contents up
      const packageDir = path.join(tempDir, 'package');
      let finalExtractDir = tempDir;
      if (fs.existsSync(packageDir)) {
        finalExtractDir = packageDir;
      }

      // Verify aion-extension.json exists
      const manifestPath = path.join(finalExtractDir, EXTENSION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid extension package: aion-extension.json missing');
      }

      // Step 4: Move to target directory
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      if (finalExtractDir === packageDir) {
        fs.renameSync(packageDir, targetDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
      } else {
        fs.renameSync(tempDir, targetDir);
      }

      // Step 5: Reload extension registry and refresh AcpDetector
      // hotReload re-scans all extension directories, discovers this new extension,
      // and runs the full lifecycle (onInstall for first-time + onActivate) via
      // the extension system's lifecycle runner (forked process, timeout, sandboxing).
      await ExtensionRegistry.hotReload();

      // Re-read extension-contributed ACP adapters from the updated registry
      // so that getAvailableAgents reflects the newly installed agent.
      await acpDetector.refreshExtensionAgents();

      hubStateManager.setTransientState(name, 'installed');
    } catch (error) {
      console.error(`[HubInstaller] Failed to install ${name}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      hubStateManager.setTransientState(name, 'install_failed', errorMessage);
      throw error;
    }
  }

  public async retryInstall(name: string): Promise<void> {
    hubStateManager.setTransientState(name, 'installing');

    try {
      const targetDir = path.join(getInstallTargetDir(), name);

      // If target directory doesn't exist, we must run the full install process again
      if (!fs.existsSync(targetDir)) {
        await this.install(name);
        return;
      }

      // Target directory exists — verify manifest then let registry handle lifecycle
      const manifestPath = path.join(targetDir, EXTENSION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Extension manifest missing, please reinstall from scratch.');
      }

      // Reload registry — it will re-discover this extension and run lifecycle hooks
      await ExtensionRegistry.hotReload();
      await acpDetector.refreshExtensionAgents();
      hubStateManager.setTransientState(name, 'installed');
    } catch (error) {
      console.error(`[HubInstaller] Failed to retry install ${name}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      hubStateManager.setTransientState(name, 'install_failed', errorMessage);
      throw error;
    }
  }

  /**
   * Resolve the zip file path for an extension.
   * Bundled extensions try local Resources first, then fall back to remote download.
   * Non-bundled extensions always download from remote.
   */
  private async resolveZipPath(name: string, distTarball: string, bundled?: boolean): Promise<string> {
    if (bundled) {
      const localPath = path.join(getHubResourcesDir(), path.basename(distTarball));
      if (fs.existsSync(localPath)) {
        return localPath;
      }
      console.warn(`[HubInstaller] Bundled zip not found at ${localPath}, falling back to remote download`);
    }

    // Download from remote mirrors (try each in order)
    const cachePath = path.join(this.getCacheDir(), `${name}.zip`);
    for (const baseUrl of HUB_REMOTE_URLS) {
      const url = new URL(distTarball, baseUrl).toString();
      try {
        await this.downloadFile(url, cachePath);
        return cachePath;
      } catch (error) {
        console.warn(`[HubInstaller] Download failed from ${url} (${error})`);
      }
    }

    throw new Error(`Failed to download ${name} from all remote sources`);
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const response = await net.fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }

    // Convert array buffer to buffer and write to disk
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(dest, Buffer.from(arrayBuffer));
  }

  private async verifyIntegrity(filePath: string, expectedSri: string): Promise<void> {
    if (!expectedSri.startsWith('sha512-')) {
      console.warn(`[HubInstaller] Unsupported integrity algorithm in ${expectedSri}, skipping check.`);
      return;
    }

    const expectedHashBase64 = expectedSri.substring('sha512-'.length);
    const expectedHashHex = Buffer.from(expectedHashBase64, 'base64').toString('hex');

    const fileBuffer = fs.readFileSync(filePath);
    const actualHashHex = crypto.createHash('sha512').update(fileBuffer).digest('hex');

    if (actualHashHex !== expectedHashHex) {
      throw new Error('Integrity verification failed! The file may be corrupted.');
    }
  }
}

export const hubInstaller = new HubInstallerImpl();
