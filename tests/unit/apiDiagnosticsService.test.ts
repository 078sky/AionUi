/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@process/WorkerManage', () => ({
  default: {
    getDebugInfo: vi.fn(() => ({
      totalTasks: 0,
      tasks: [],
    })),
  },
}));

vi.mock('@process/services/cron/CronBusyGuard', () => ({
  cronBusyGuard: {
    getAllStates: vi.fn(() => new Map()),
  },
}));

vi.mock('@process/services/ConversationTurnCompletionService', () => ({
  ConversationTurnCompletionService: {
    getInstance: () => ({
      getDebugState: () => ({
        emittedKeyCount: 0,
        inFlightCount: 0,
        emittedKeys: [],
        inFlightSessionIds: [],
      }),
    }),
  },
  formatStatusLastMessage: vi.fn((message) => message),
  getConversationStatusSnapshot: vi.fn(() => null),
}));

vi.mock('@process/message', () => ({
  getConversationMessageCacheStats: vi.fn(() => ({
    size: 0,
    conversations: [],
  })),
}));

vi.mock('@process/database', () => ({
  getDatabase: vi.fn(() => ({
    getUserConversations: vi.fn(() => ({
      total: 0,
    })),
  })),
}));

describe('ApiDiagnosticsService', () => {
  it('applies runtime config updates and normalizes values', async () => {
    const { ApiDiagnosticsService } = await import('../../src/process/services/ApiDiagnosticsService');

    const service = new ApiDiagnosticsService({
      enabled: false,
      outputDir: 'logs/diagnostics',
      sampleIntervalMs: 3000,
    });

    expect(service.getConfig()).toEqual({
      enabled: false,
      outputDir: path.resolve('logs/diagnostics'),
      sampleIntervalMs: 3000,
    });

    service.updateConfig({
      enabled: true,
      outputDir: '',
      sampleIntervalMs: 20,
    });

    expect(service.getConfig().enabled).toBe(true);
    expect(service.getConfig().sampleIntervalMs).toBe(1000);
    expect(path.isAbsolute(service.getConfig().outputDir)).toBe(true);
  });

  it('captures only when enabled and respects sample throttling', async () => {
    const { ApiDiagnosticsService } = await import('../../src/process/services/ApiDiagnosticsService');

    const service = new ApiDiagnosticsService({
      enabled: false,
      outputDir: 'logs/diagnostics',
      sampleIntervalMs: 60000,
    });

    expect(
      service.captureRouteSample({
        route: '/status',
        reason: 'poll',
        persist: false,
      })
    ).toEqual({
      enabled: false,
      recorded: false,
    });

    service.updateConfig({ enabled: true });
    vi.spyOn(service, 'createSnapshot').mockReturnValue({
      timestamp: '2026-03-14T00:00:00.000Z',
      route: '/status',
      reason: 'poll',
      sessionId: null,
      process: {
        pid: 1,
      },
    } as never);

    const first = service.captureRouteSample({
      route: '/status',
      reason: 'poll',
      persist: false,
    });

    const second = service.captureRouteSample({
      route: '/status',
      reason: 'poll',
      persist: false,
    });

    expect(first.enabled).toBe(true);
    expect(first.recorded).toBe(true);
    expect(first.snapshot).toBeTruthy();
    expect(service.getRecentCaptures()).toHaveLength(1);
    expect(service.getRecentCaptures()[0]?.snapshot).toEqual(first.snapshot);
    expect(second).toEqual({
      enabled: true,
      recorded: false,
    });
  });
});
