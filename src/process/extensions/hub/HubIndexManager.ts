import type { HubExtensionStatus, IHubAgentItem, IHubExtension, IHubIndex } from '@/common/types/hub';
import { acpDetector } from '@process/agent/acp/AcpDetector';
import { net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionRegistry } from '@process/extensions/ExtensionRegistry';
import {
  EXTENSION_MANIFEST_FILE,
  HUB_REMOTE_URLS,
  HUB_INDEX_FILE,
  getHubResourcesDir,
} from '@process/extensions/constants';
import { hubStateManager } from '@process/extensions/hub/HubStateManager';

/**
 * HubIndexManager
 *
 * Merges local bundled index + remote index, resolves `bundled` flag,
 * and derives runtime status for each extension.
 *
 * Data flow:
 *   1. AcpDetector completes first (external dependency)
 *   2. Load local bundled index
 *   3. Fetch remote index as supplement (local takes priority on conflict)
 *   4. Resolve `bundled` flag: true only if zip exists in Resources dir
 *   5. Derive status: AcpDetector-detected agents → installed
 */
class HubIndexManagerImpl {
  private mergedIndex: Record<string, IHubExtension> = {};
  private localLoaded = false;
  private remoteLoaded = false;

  /**
   * Load and merge indexes.
   * Local index is loaded once. Remote index is retried on every call
   * until it succeeds, so opening the Hub Modal after a network failure
   * will automatically retry.
   */
  public async loadIndexes(): Promise<void> {
    // Step 1: Local index — load once
    if (!this.localLoaded) {
      const localIndex = this.fetchLocalIndex();
      for (const [name, ext] of Object.entries(localIndex)) {
        this.mergedIndex[name] = ext;
      }
      this.localLoaded = true;
    }

    // Step 2: Remote index — retry until success
    if (!this.remoteLoaded) {
      const remoteIndex = await this.fetchRemoteIndex();
      if (Object.keys(remoteIndex).length > 0) {
        // Merge: existing (local) wins on name conflict
        for (const [name, ext] of Object.entries(remoteIndex)) {
          if (!this.mergedIndex[name]) {
            this.mergedIndex[name] = ext;
          }
        }
        this.remoteLoaded = true;
      }
    }

    // Step 3: Resolve `bundled` flag — true only if zip actually exists in Resources
    const hubDir = getHubResourcesDir();
    for (const ext of Object.values(this.mergedIndex)) {
      ext.bundled = fs.existsSync(path.join(hubDir, path.basename(ext.dist.tarball)));
    }
  }

  public getExtensionList(): Record<string, IHubExtension> {
    return this.mergedIndex;
  }

  public getExtension(name: string): IHubExtension | undefined {
    return this.mergedIndex[name];
  }

  /**
   * Returns the full extension list with runtime status.
   */
  public getExtensionListWithStatus(): IHubAgentItem[] {
    const loadedByName = new Map(
      ExtensionRegistry.getInstance()
        .getLoadedExtensions()
        .map((e) => [e.manifest.name, e])
    );

    const detectedAgents = acpDetector.getDetectedAgents();
    const detectedBackends = new Set<string>(
      detectedAgents
        .map((a) => {
          if (a.backend === 'custom' && a.isExtension) return a.customAgentId ?? a.name;
          if (a.backend !== 'custom') return a.backend;
          return null; // only return known backends and extension-contributed agents
        })
        .filter((b): b is string => b !== null)
    );

    console.log(
      `[HubIndexManager] Status context: ${loadedByName.size} loaded extension(s) [${[...loadedByName.keys()].join(', ')}], ` +
        `${detectedAgents.length} detected agent(s) [${[...detectedBackends].join(', ')}], ` +
        `${Object.keys(this.mergedIndex).length} hub extension(s)`
    );

    const result: IHubAgentItem[] = [];

    for (const ext of Object.values(this.mergedIndex)) {
      const status = this.deriveStatus(ext, loadedByName, detectedBackends);

      result.push({
        ...ext,
        status,
        installError: hubStateManager.getPersistentInstallError(ext.name),
      });
    }

    return result;
  }

  /**
   * Derive the runtime status for a single hub extension.
   *
   * Priority:
   *   1. Transient state (installing / uninstalling)
   *   2. Persistent install error
   *   3. Loaded in ExtensionRegistry (check for update)
   *   4. AcpDetector already detected all contributed backends → installed
   *   5. not_installed
   */
  private deriveStatus(
    ext: IHubExtension,
    loadedByName: Map<string, { directory: string }>,
    detectedBackends: Set<string>
  ): HubExtensionStatus {
    // 1. Transient state (installing / uninstalling)
    const transient = hubStateManager.getTransientState(ext.name);
    if (transient) return transient;

    // 2. Persistent install error
    const hasError = hubStateManager.getPersistentInstallError(ext.name);
    if (hasError) return 'install_failed';

    // 3. Loaded in ExtensionRegistry — check for update
    const loaded = loadedByName.get(ext.name);
    if (loaded) {
      const manifestPath = path.join(loaded.directory, EXTENSION_MANIFEST_FILE);
      try {
        if (fs.existsSync(manifestPath)) {
          const localManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          if (localManifest.dist?.integrity && localManifest.dist.integrity !== ext.dist.integrity) {
            return 'update_available';
          }
        }
      } catch {
        // Ignore read errors — treat as installed
      }
    }

    // 4. All contributed acpAdapters are already detected on system
    const adapterIds = ext.contributes?.acpAdapters;
    if (adapterIds && adapterIds.length > 0) {
      if (adapterIds.every((id) => detectedBackends.has(id))) {
        return 'installed';
      }
    }

    return 'not_installed';
  }

  private fetchLocalIndex(): Record<string, IHubExtension> {
    try {
      const indexPath = path.join(getHubResourcesDir(), 'index.json');

      if (!fs.existsSync(indexPath)) {
        return {};
      }

      const content = fs.readFileSync(indexPath, 'utf-8');
      const data = JSON.parse(content) as IHubIndex;

      return data.extensions ?? {};
    } catch (error) {
      console.error('[HubIndexManager] Failed to read local bundled index:', error);
      return {};
    }
  }

  private async fetchRemoteIndex(): Promise<Record<string, IHubExtension>> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Fetch timeout')), 5000)
    );

    for (const baseUrl of HUB_REMOTE_URLS) {
      const url = new URL(HUB_INDEX_FILE, baseUrl).toString();
      try {
        console.log(`[HubIndexManager] Attempting to fetch remote index from: ${url}`);

        const response = (await Promise.race([net.fetch(url), timeoutPromise])) as Response;
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = (await response.json()) as IHubIndex;
        return data.extensions ?? {};
      } catch (error) {
        console.warn(`[HubIndexManager] Fetch failed from ${url} (${error})`);
      }
    }
    console.error('[HubIndexManager] Failed to fetch remote index from all sources');
    return {};
  }
}

export const hubIndexManager = new HubIndexManagerImpl();
