// Cron job endpoint types - extracted from ipcBridge.ts

import type { AcpBackendAll } from '../types/acpTypes';

export type ICronSchedule =
  | { kind: 'at'; atMs: number; description: string }
  | { kind: 'every'; everyMs: number; description: string }
  | { kind: 'cron'; expr: string; tz?: string; description: string };

export type ICronJob = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: ICronSchedule;
  target: { payload: { kind: 'message'; text: string } };
  metadata: {
    conversationId: string;
    conversationTitle?: string;
    agentType: AcpBackendAll;
    createdBy: 'user' | 'agent';
    createdAt: number;
    updatedAt: number;
  };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: 'ok' | 'error' | 'skipped' | 'missed';
    lastError?: string;
    runCount: number;
    retryCount: number;
    maxRetries: number;
  };
};

export type ICreateCronJobParams = {
  name: string;
  schedule: ICronSchedule;
  message: string;
  conversationId: string;
  conversationTitle?: string;
  agentType: AcpBackendAll;
  createdBy: 'user' | 'agent';
};
