/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

const DEV_PROFILE_ENV = 'AIONUI_DEV_PROFILE';
const DEV_PROFILE_SUFFIX_ENV = 'AIONUI_DEV_PROFILE_SUFFIX';
const SAFE_SUFFIX_PATTERN = /[^A-Za-z0-9._-]+/g;

const sanitizeProfileSuffix = (value: string | undefined): string | null => {
  if (!value) return null;
  const normalized = value
    .trim()
    .replace(SAFE_SUFFIX_PATTERN, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : null;
};

/**
 * Resolve the optional dev profile suffix used to isolate concurrent dev/E2E runs.
 */
export function getDevProfileSuffix(): string | null {
  const customSuffix = sanitizeProfileSuffix(process.env[DEV_PROFILE_ENV] || process.env[DEV_PROFILE_SUFFIX_ENV]);
  if (customSuffix) {
    return customSuffix;
  }

  return process.env.AIONUI_MULTI_INSTANCE === '1' ? '2' : null;
}

/**
 * Backward-compatible name used by config helpers.
 */
export function getConfiguredDevProfile(): string | null {
  return getDevProfileSuffix();
}

/**
 * Resolve the suffix appended to CLI-safe symlink names in dev mode.
 */
export function getDevEnvironmentSuffix(): string {
  const suffix = getDevProfileSuffix();
  return suffix ? `-dev-${suffix}` : '-dev';
}

/**
 * Resolve the Electron app name used for dev-profile isolation.
 */
export function resolveDevAppName(): string {
  const suffix = getDevProfileSuffix();
  return suffix ? `AionUi-Dev-${suffix}` : 'AionUi-Dev';
}

/**
 * Backward-compatible name used by configureChromium/platform init.
 */
export function getDevAppName(): string {
  return resolveDevAppName();
}
