/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitSpy = vi.fn();
let flushed = false;

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      turnCompleted: {
        emit: emitSpy,
      },
    },
  },
}));

vi.mock('@process/message', () => ({
  flushConversationMessages: vi.fn(async () => {
    flushed = true;
  }),
}));

vi.mock('@process/WorkerManage', () => ({
  default: {
    getTaskById: vi.fn(() => undefined),
  },
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: {
    isProcessing: vi.fn(() => false),
  },
}));

vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getConversation: vi.fn(() => ({
      success: true,
      data: {
        id: 'session-1',
        type: 'gemini',
        status: 'finished',
        extra: {
          workspace: 'E:/workspace',
        },
        model: {
          platform: 'openai',
          name: 'OpenAI',
          useModel: 'gpt-4o-mini',
        },
      },
    })),
    getConversationMessages: vi.fn(() => ({
      data: [
        flushed
          ? {
              id: 'assistant-1',
              type: 'text',
              position: 'left',
              content: { content: 'done' },
              createdAt: 1,
            }
          : {
              id: 'user-1',
              type: 'text',
              position: 'right',
              content: { content: 'hello' },
              createdAt: 0,
            },
      ],
    })),
  }),
}));

describe('ConversationTurnCompletionService', () => {
  beforeEach(() => {
    flushed = false;
    emitSpy.mockReset();
    vi.resetModules();
  });

  it('flushes pending messages before emitting turn completion', async () => {
    const { ConversationTurnCompletionService } = await import('../../src/process/services/ConversationTurnCompletionService');

    await ConversationTurnCompletionService.getInstance().notifyPotentialCompletion('session-1');

    expect(flushed).toBe(true);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        state: 'stopped',
        lastMessage: expect.objectContaining({
          id: 'assistant-1',
        }),
      })
    );
  });
});
