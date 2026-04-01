import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: vi.fn(() => '/tmp') } }));

const mockExistsSync = vi.fn(() => false);
const mockReadFileSync = vi.fn(() => '{}');
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

const mockGetTransientState = vi.fn();
const mockGetPersistentInstallError = vi.fn();
vi.mock('../../src/process/extensions/hub/HubStateManager', () => ({
  hubStateManager: {
    getTransientState: (...args: unknown[]) => mockGetTransientState(...args),
    getPersistentInstallError: (...args: unknown[]) => mockGetPersistentInstallError(...args),
  },
}));

const mockGetDetectedAgents = vi.fn(
  (): Array<{ backend: string; name: string; cliPath?: string; isExtension?: boolean; customAgentId?: string }> => []
);
vi.mock('@process/agent/acp/AcpDetector', () => ({
  acpDetector: {
    getDetectedAgents: () => mockGetDetectedAgents(),
  },
}));

vi.mock('../../../src/process/extensions/constants', () => ({
  EXTENSION_MANIFEST_FILE: 'aion-extension.json',
  HUB_REMOTE_URLS: ['https://example.com/hub'],
  getHubResourcesDir: vi.fn(() => '/resources/hub'),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { hubIndexManager } from '../../src/process/extensions/hub/HubIndexManager';
import type { IHubExtension } from '@/common/types/hub';

function makeExt(overrides: Partial<IHubExtension> & { name: string }): IHubExtension {
  return {
    displayName: overrides.name,
    description: 'test',
    author: 'test',
    dist: { tarball: `${overrides.name}.zip`, integrity: 'sha512-abc', unpackedSize: 100 },
    engines: { aionui: '>=1.0.0' },
    hubs: ['acpAdapters'],
    ...overrides,
  };
}

describe('HubIndexManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockFetch.mockRejectedValue(new Error('no network'));
    // Reset singleton state so each test starts fresh
    (hubIndexManager as any)['mergedIndex'] = {};
    (hubIndexManager as any)['localLoaded'] = false;
    (hubIndexManager as any)['remoteLoaded'] = false;
  });

  describe('loadIndexes', () => {
    it('should load local index when available', async () => {
      const localIndex = {
        schemaVersion: 1,
        generatedAt: '2025-01-01',
        extensions: {
          'ext-a': makeExt({ name: 'ext-a' }),
        },
      };

      mockExistsSync.mockImplementation((p: string) => p.includes('index.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify(localIndex));

      await hubIndexManager.loadIndexes();
      expect(hubIndexManager.getExtension('ext-a')).toBeDefined();
    });

    it('should merge remote index as supplement (local wins on conflict)', async () => {
      const localExt = makeExt({ name: 'shared', description: 'local version' });
      const remoteExt = makeExt({ name: 'shared', description: 'remote version' });
      const remoteOnly = makeExt({ name: 'remote-only' });

      const localIndex = { schemaVersion: 1, generatedAt: '', extensions: { shared: localExt } };
      const remoteIndex = {
        schemaVersion: 1,
        generatedAt: '',
        extensions: { shared: remoteExt, 'remote-only': remoteOnly },
      };

      mockExistsSync.mockImplementation((p: string) => p.includes('index.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify(localIndex));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => remoteIndex,
      });

      await hubIndexManager.loadIndexes();

      // Local wins on conflict
      expect(hubIndexManager.getExtension('shared')?.description).toBe('local version');
      // Remote supplement is added
      expect(hubIndexManager.getExtension('remote-only')).toBeDefined();
    });

    it('should fall back to local only when remote fails', async () => {
      const localIndex = {
        schemaVersion: 1,
        generatedAt: '',
        extensions: { 'local-ext': makeExt({ name: 'local-ext' }) },
      };

      mockExistsSync.mockImplementation((p: string) => p.includes('index.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify(localIndex));
      mockFetch.mockRejectedValue(new Error('timeout'));

      await hubIndexManager.loadIndexes();
      expect(hubIndexManager.getExtension('local-ext')).toBeDefined();
    });

    it('should resolve bundled flag based on zip existence', async () => {
      const ext = makeExt({
        name: 'bundled-ext',
        dist: { tarball: 'bundled-ext.zip', integrity: '', unpackedSize: 0 },
      });
      const localIndex = { schemaVersion: 1, generatedAt: '', extensions: { 'bundled-ext': ext } };

      mockExistsSync.mockImplementation((p: string) => {
        if (p.includes('index.json')) return true;
        if (p.includes('bundled-ext.zip')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue(JSON.stringify(localIndex));

      await hubIndexManager.loadIndexes();
      expect(hubIndexManager.getExtension('bundled-ext')?.bundled).toBe(true);
    });
  });

  describe('getExtensionListWithStatus / deriveStatus', () => {
    beforeEach(async () => {
      const ext = makeExt({
        name: 'test-ext',
        contributes: { acpAdapters: ['claude'] },
      });
      const localIndex = { schemaVersion: 1, generatedAt: '', extensions: { 'test-ext': ext } };

      mockExistsSync.mockImplementation((p: string) => p.includes('index.json'));
      mockReadFileSync.mockReturnValue(JSON.stringify(localIndex));

      await hubIndexManager.loadIndexes();
    });

    it('should return installing when transient state is set', () => {
      mockGetTransientState.mockReturnValue('installing');

      const list = hubIndexManager.getExtensionListWithStatus();
      expect(list[0].status).toBe('installing');
    });

    it('should return install_failed when persistent error exists', () => {
      mockGetTransientState.mockReturnValue(undefined);
      mockGetPersistentInstallError.mockReturnValue('some error');

      const list = hubIndexManager.getExtensionListWithStatus();
      expect(list[0].status).toBe('install_failed');
      expect(list[0].installError).toBe('some error');
    });

    it('should return installed when all contributed acpAdapters are detected', () => {
      mockGetTransientState.mockReturnValue(undefined);
      mockGetPersistentInstallError.mockReturnValue(undefined);
      mockGetDetectedAgents.mockReturnValue([{ backend: 'claude', name: 'Claude Code', cliPath: 'claude' }]);

      const list = hubIndexManager.getExtensionListWithStatus();
      expect(list[0].status).toBe('installed');
    });

    it('should return not_installed when contributed adapters are not detected', () => {
      mockGetTransientState.mockReturnValue(undefined);
      mockGetPersistentInstallError.mockReturnValue(undefined);
      mockGetDetectedAgents.mockReturnValue([]);

      const list = hubIndexManager.getExtensionListWithStatus();
      expect(list[0].status).toBe('not_installed');
    });
  });
});
