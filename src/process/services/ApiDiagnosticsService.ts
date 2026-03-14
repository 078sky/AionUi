/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import WorkerManage from '@process/WorkerManage';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { ConversationTurnCompletionService, formatStatusLastMessage, getConversationStatusSnapshot } from '@process/services/ConversationTurnCompletionService';
import { getConversationMessageCacheStats } from '@process/message';
import { getDatabase } from '@process/database';

type DiagnosticsSnapshotInput = {
  route: string;
  reason: string;
  sessionId?: string;
};

export type ApiDiagnosticsConfig = {
  enabled: boolean;
  outputDir: string;
  sampleIntervalMs: number;
};

export type ApiDiagnosticsHistoryEntry = {
  filePath?: string;
  snapshot: ReturnType<ApiDiagnosticsService['createSnapshot']>;
};

const DEFAULT_DIAGNOSTICS_INTERVAL_MS = 60_000;
const DEFAULT_DIAGNOSTICS_DIR = path.resolve(process.cwd(), '.aionui', 'diagnostics', 'api');
const MAX_RECENT_CAPTURES = 200;

const parseEnabledFlag = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const normalizeOutputDir = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return path.resolve(trimmed || DEFAULT_DIAGNOSTICS_DIR);
};

const normalizeSampleIntervalMs = (value: number | string | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(Math.trunc(value), 1000);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(parsed, 1000);
    }
  }

  return DEFAULT_DIAGNOSTICS_INTERVAL_MS;
};

const getSerializedLength = (value: unknown): number | null => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
};

const sanitizeSessionSnapshot = (sessionId: string) => {
  const snapshot = getConversationStatusSnapshot(sessionId);
  if (!snapshot) {
    return null;
  }

  return {
    sessionId: snapshot.sessionId,
    conversationId: snapshot.conversation.id,
    type: snapshot.conversation.type,
    source: snapshot.conversation.source,
    status: snapshot.status,
    state: snapshot.state,
    detail: snapshot.detail,
    canSendMessage: snapshot.canSendMessage,
    runtime: snapshot.runtime,
    lastMessage: snapshot.lastMessage
      ? {
          ...formatStatusLastMessage(snapshot.lastMessage),
          position: snapshot.lastMessage.position ?? null,
          contentSummary:
            snapshot.lastMessage.content === null || snapshot.lastMessage.content === undefined
              ? null
              : {
                  kind: typeof snapshot.lastMessage.content,
                  serializedLength: getSerializedLength(snapshot.lastMessage.content),
                },
        }
      : null,
  };
};

export class ApiDiagnosticsService {
  private enabled: boolean;
  private outputDir: string;
  private sampleIntervalMs: number;
  private readonly lastRecordedAt = new Map<string, number>();
  private readonly recentCaptures: ApiDiagnosticsHistoryEntry[] = [];

  constructor(initialConfig: Partial<ApiDiagnosticsConfig> = {}) {
    this.enabled = initialConfig.enabled ?? parseEnabledFlag(process.env.AIONUI_API_DIAGNOSTICS);
    this.outputDir = normalizeOutputDir(initialConfig.outputDir ?? process.env.AIONUI_API_DIAGNOSTICS_DIR);
    this.sampleIntervalMs = normalizeSampleIntervalMs(initialConfig.sampleIntervalMs ?? process.env.AIONUI_API_DIAGNOSTICS_INTERVAL_MS);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getConfig(): ApiDiagnosticsConfig {
    return {
      enabled: this.enabled,
      outputDir: this.outputDir,
      sampleIntervalMs: this.sampleIntervalMs,
    };
  }

  updateConfig(nextConfig: Partial<ApiDiagnosticsConfig>): ApiDiagnosticsConfig {
    if (typeof nextConfig.enabled === 'boolean') {
      this.enabled = nextConfig.enabled;
    }

    if (typeof nextConfig.outputDir === 'string') {
      this.outputDir = normalizeOutputDir(nextConfig.outputDir);
    }

    if (nextConfig.sampleIntervalMs !== undefined) {
      this.sampleIntervalMs = normalizeSampleIntervalMs(nextConfig.sampleIntervalMs);
    }

    return this.getConfig();
  }

  getRecentCaptures(limit = 20): ApiDiagnosticsHistoryEntry[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(Math.trunc(limit), 1) : 20;
    return this.recentCaptures.slice(-normalizedLimit);
  }

  createSnapshot(input: DiagnosticsSnapshotInput) {
    const db = getDatabase();
    const conversationCount = db.getUserConversations(undefined, 0, 1).total;
    const messageCache = getConversationMessageCacheStats();
    const busyStates = Array.from(cronBusyGuard.getAllStates().entries()).map(([conversationId, state]) => ({
      conversationId,
      ...state,
    }));

    return {
      timestamp: new Date().toISOString(),
      route: input.route,
      reason: input.reason,
      sessionId: input.sessionId ?? null,
      process: {
        pid: process.pid,
        platform: process.platform,
        arch: process.arch,
        uptimeSec: Math.round(process.uptime()),
        memoryUsage: process.memoryUsage(),
      },
      heap: {
        statistics: v8.getHeapStatistics(),
        spaces: v8.getHeapSpaceStatistics(),
      },
      runtime: {
        conversationCount,
        workerManage: WorkerManage.getDebugInfo(),
        busyGuard: {
          count: busyStates.length,
          states: busyStates,
        },
        messageCache,
        turnCompletion: ConversationTurnCompletionService.getInstance().getDebugState(),
      },
      session: input.sessionId ? sanitizeSessionSnapshot(input.sessionId) : null,
    };
  }

  captureRouteSample(input: DiagnosticsSnapshotInput & { force?: boolean; persist?: boolean }): {
    enabled: boolean;
    recorded: boolean;
    filePath?: string;
    snapshot?: ReturnType<ApiDiagnosticsService['createSnapshot']>;
  } {
    if (!this.enabled) {
      return {
        enabled: false,
        recorded: false,
      };
    }

    const now = Date.now();
    const key = `${input.route}:${input.sessionId || 'global'}`;
    const lastRecordedAt = this.lastRecordedAt.get(key) || 0;
    if (!input.force && now - lastRecordedAt < this.sampleIntervalMs) {
      return {
        enabled: true,
        recorded: false,
      };
    }

    const snapshot = this.createSnapshot(input);
    this.lastRecordedAt.set(key, now);

    if (input.persist !== false) {
      const filePath = this.persistSnapshot(snapshot);
      this.recordCapture({
        filePath,
        snapshot,
      });

      return {
        enabled: true,
        recorded: true,
        snapshot,
        filePath,
      };
    }

    this.recordCapture({
      snapshot,
    });

    return {
      enabled: true,
      recorded: true,
      snapshot,
    };
  }

  private persistSnapshot(snapshot: ReturnType<ApiDiagnosticsService['createSnapshot']>): string {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const filePath = path.join(this.outputDir, `conversation-api-diagnostics-${new Date().toISOString().slice(0, 10)}.ndjson`);
    fs.appendFileSync(filePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
    return filePath;
  }

  private recordCapture(entry: ApiDiagnosticsHistoryEntry): void {
    this.recentCaptures.push(entry);
    if (this.recentCaptures.length > MAX_RECENT_CAPTURES) {
      this.recentCaptures.splice(0, this.recentCaptures.length - MAX_RECENT_CAPTURES);
    }
  }
}

export const apiDiagnosticsService = new ApiDiagnosticsService();
