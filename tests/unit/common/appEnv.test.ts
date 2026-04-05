import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({ paths: { isPackaged: () => false } }),
}));

describe('common/appEnv', () => {
  beforeEach(() => {
    vi.doMock('@/common/platform', () => ({
      getPlatformServices: () => ({ paths: { isPackaged: () => false } }),
    }));
  });

  afterEach(() => {
    delete process.env.AIONUI_MULTI_INSTANCE;
    delete process.env.AIONUI_DEV_PROFILE;
    delete process.env.AIONUI_DEV_PROFILE_SUFFIX;
    vi.doUnmock('@/common/platform');
    vi.resetModules();
  });

  it('appends -dev suffix in dev builds', async () => {
    const { getEnvAwareName } = await import('../../../src/common/config/appEnv');
    expect(getEnvAwareName('.aionui')).toBe('.aionui-dev');
    expect(getEnvAwareName('.aionui-config')).toBe('.aionui-config-dev');
  });

  it('returns baseName unchanged in release builds', async () => {
    vi.doMock('@/common/platform', () => ({
      getPlatformServices: () => ({ paths: { isPackaged: () => true } }),
    }));
    const { getEnvAwareName } = await import('../../../src/common/config/appEnv');
    expect(getEnvAwareName('.aionui')).toBe('.aionui');
    expect(getEnvAwareName('.aionui-config')).toBe('.aionui-config');
  });

  it('keeps the multi-instance -dev-2 suffix when no custom dev profile is configured', async () => {
    process.env.AIONUI_MULTI_INSTANCE = '1';
    const { getEnvAwareName } = await import('../../../src/common/config/appEnv');
    expect(getEnvAwareName('.aionui')).toBe('.aionui-dev-2');
    expect(getEnvAwareName('.aionui-config')).toBe('.aionui-config-dev-2');
  });

  it('uses a hermetic dev profile suffix when AIONUI_DEV_PROFILE is set', async () => {
    process.env.AIONUI_MULTI_INSTANCE = '1';
    process.env.AIONUI_DEV_PROFILE = 'acp e2e/profile';

    const { getEnvAwareName } = await import('../../../src/common/config/appEnv');
    const { getConfiguredDevProfile, getDevAppName } = await import('../../../src/common/config/devProfile');

    expect(getConfiguredDevProfile()).toBe('acp-e2e-profile');
    expect(getEnvAwareName('.aionui')).toBe('.aionui-dev-acp-e2e-profile');
    expect(getEnvAwareName('.aionui-config')).toBe('.aionui-config-dev-acp-e2e-profile');
    expect(getDevAppName()).toBe('AionUi-Dev-acp-e2e-profile');
  });
});
