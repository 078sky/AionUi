/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';

/**
 * Service for API configuration management
 * API 配置管理服务
 */
export class ApiConfigService {
  /**
   * Generate a secure 64-character API token
   * Base62 encoding: A-Za-z0-9
   * 生成一个安全的 64 位 API token
   */
  static generateApiToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.randomBytes(64);

    return Array.from(bytes)
      .map((b) => chars[b % chars.length])
      .join('');
  }

  /**
   * Validate API token format
   * 验证 API token 格式
   */
  static isValidTokenFormat(token: string): boolean {
    return /^[A-Za-z0-9]{64}$/.test(token);
  }
}
