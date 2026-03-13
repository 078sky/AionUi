/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_JS_FILTER_SCRIPT } from '@/common/apiCallback';
import type { IApiConfig } from '@/common/storage';
import { Script, createContext } from 'vm';

type CallbackTemplateVariables = Record<string, unknown> & {
  conversationHistory?: unknown;
  lastMessage?: unknown;
  model?: unknown;
  sessionId?: unknown;
  workspace?: unknown;
};

/**
 * Service for sending HTTP callbacks
 * HTTP 回调发送服务
 */
export class CallbackService {
  /**
   * Replace template variables in JSON string
   * 替换 JSON 字符串中的模板变量
   *
   * Supported variables:
   * - {{conversationHistory}} - Array of messages
   * - {{sessionId}} - Conversation ID
   * - {{workspace}} - Workspace path
   * - {{model}} - Model information
   * - {{lastMessage}} - Last message object
   */
  static replaceVariables(template: string, variables: Record<string, any>): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const replacement = typeof value === 'string' ? value : JSON.stringify(value);
      result = result.replaceAll(placeholder, replacement);
    }

    return result;
  }

  static createTemplateVariables(config: IApiConfig, variables: CallbackTemplateVariables): Record<string, unknown> {
    return {
      ...variables,
      jsFitterStr: this.buildJsFitterStr(config, variables),
    };
  }

  private static buildJsFitterStr(config: IApiConfig, variables: CallbackTemplateVariables): string {
    if (!config.jsFilterEnabled) {
      return '';
    }

    const scriptSource = config.jsFilterScript?.trim() || DEFAULT_JS_FILTER_SCRIPT;
    const input = {
      sessionId: typeof variables.sessionId === 'string' ? variables.sessionId : '',
      workspace: typeof variables.workspace === 'string' ? variables.workspace : '',
      model: variables.model ?? null,
      lastMessage: variables.lastMessage ?? null,
      conversationHistory: Array.isArray(variables.conversationHistory) ? variables.conversationHistory : [],
    };

    try {
      const context = createContext({ input });
      const script = new Script(`
${scriptSource}

if (typeof jsFilter !== 'function') {
  throw new Error('Callback JS filter must define a jsFilter(input) function');
}

jsFilter(input);
`);
      const result = script.runInContext(context, { timeout: 1000 });
      return typeof result === 'string' ? result : String(result ?? '');
    } catch (error) {
      console.error('[CallbackService] Failed to execute callback JS filter:', error);
      return '';
    }
  }

  /**
   * Send HTTP callback request
   * 发送 HTTP 回调请求
   */
  static async sendCallback(config: IApiConfig, variables: Record<string, any>): Promise<{ success: boolean; error?: string }> {
    if (!config.callbackEnabled || !config.callbackUrl) {
      return { success: false, error: 'Callback URL not configured' };
    }

    try {
      const templateVariables = this.createTemplateVariables(config, variables);

      // 1. Prepare request body
      let body: string | undefined;
      if (config.callbackBody) {
        body = this.replaceVariables(config.callbackBody, templateVariables);
      }

      // 2. Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.callbackHeaders,
      };

      // 3. Send HTTP request
      const response = await fetch(config.callbackUrl, {
        method: config.callbackMethod,
        headers,
        body: config.callbackMethod !== 'GET' ? body : undefined,
        signal: AbortSignal.timeout(30000), // 30s timeout
      });

      if (!response.ok) {
        const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        console.error(`[CallbackService] Callback failed -`, errorMsg);
        return { success: false, error: errorMsg };
      }

      console.log(`[CallbackService] Callback sent successfully to ${config.callbackUrl}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[CallbackService] Callback failed:', errorMsg);
      return { success: false, error: errorMsg };
    }
  }
}
