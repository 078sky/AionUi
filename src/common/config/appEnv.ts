/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPlatformServices } from '@/common/platform';
import { getDevEnvironmentSuffix } from './devProfile';

/**
 * Returns baseName unchanged in release builds, or a dev-profile-aware suffix in dev builds.
 * `AIONUI_DEV_PROFILE` overrides the default dev naming and gives hermetic runs
 * their own isolated data/config directories.
 * When `AIONUI_DEV_PROFILE` is unset, `AIONUI_MULTI_INSTANCE=1` still appends `-2`
 * to isolate the second dev instance.
 * Used to isolate symlink and directory names between environments.
 *
 * @example
 * getEnvAwareName('.aionui')        // release → '.aionui',        dev → '.aionui-dev'
 * getEnvAwareName('.aionui-config') // release → '.aionui-config', dev → '.aionui-config-dev'
 * // with AIONUI_MULTI_INSTANCE=1:  dev → '.aionui-dev-2'
 * // with AIONUI_DEV_PROFILE=acp-e2e: dev → '.aionui-dev-acp-e2e'
 */
export function getEnvAwareName(baseName: string): string {
  if (getPlatformServices().paths.isPackaged() === true) return baseName;
  return `${baseName}${getDevEnvironmentSuffix()}`;
}
