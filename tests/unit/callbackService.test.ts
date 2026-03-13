/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_JS_FILTER_SCRIPT } from '../../src/common/apiCallback';
import { CallbackService } from '../../src/webserver/services/CallbackService';

describe('CallbackService.createTemplateVariables', () => {
  const baseConfig = {
    id: 1,
    enabled: true,
    callbackEnabled: true,
    callbackMethod: 'POST' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('returns empty jsFitterStr when JS filter is disabled', () => {
    const variables = CallbackService.createTemplateVariables(
      {
        ...baseConfig,
        jsFilterEnabled: false,
      },
      {
        sessionId: 'session-1',
        workspace: 'workspace-1',
      }
    );

    expect(variables.jsFitterStr).toBe('');
  });

  it('runs the default JS filter and keeps only the last 1024 characters', () => {
    const longHistory = Array.from({ length: 400 }, (_, index) => `message-${index}`).join('');
    const variables = CallbackService.createTemplateVariables(
      {
        ...baseConfig,
        jsFilterEnabled: true,
        jsFilterScript: DEFAULT_JS_FILTER_SCRIPT,
      },
      {
        sessionId: 'session-1',
        workspace: 'workspace-1',
        model: { id: 'provider-1', useModel: 'gpt-test' },
        lastMessage: { content: longHistory },
        conversationHistory: [{ id: '1', content: longHistory }],
      }
    );

    expect(typeof variables.jsFitterStr).toBe('string');
    expect((variables.jsFitterStr as string).length).toBeLessThanOrEqual(1024);
  });

  it('falls back to empty jsFitterStr when the user script is invalid', () => {
    const variables = CallbackService.createTemplateVariables(
      {
        ...baseConfig,
        jsFilterEnabled: true,
        jsFilterScript: 'function nope() { return "x"; }',
      },
      {
        sessionId: 'session-1',
      }
    );

    expect(variables.jsFitterStr).toBe('');
  });
});
