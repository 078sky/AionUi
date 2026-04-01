/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Types only — runtime functions and constants
// remain in src/common/utils/protocolDetector.ts

export type ProtocolType = 'openai' | 'gemini' | 'anthropic' | 'unknown';

export interface ProtocolDetectionResult {
  protocol: ProtocolType;
  success: boolean;
  confidence: number;
  latency?: number;
  error?: string;
  fixedBaseUrl?: string;
  metadata?: {
    models?: string[];
    apiVersion?: string;
    providerName?: string;
  };
}

export interface MultiKeyTestResult {
  total: number;
  valid: number;
  invalid: number;
  details: Array<{
    index: number;
    maskedKey: string;
    valid: boolean;
    error?: string;
    latency?: number;
  }>;
}

export interface ProtocolDetectionRequest {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  testAllKeys?: boolean;
  preferredProtocol?: ProtocolType;
}

export interface ProtocolDetectionResponse {
  success: boolean;
  protocol: ProtocolType;
  confidence: number;
  error?: string;
  fixedBaseUrl?: string;
  suggestion?: {
    type: 'switch_platform' | 'fix_url' | 'check_key' | 'none';
    message: string;
    suggestedPlatform?: string;
    i18nKey?: string;
    i18nParams?: Record<string, string>;
  };
  multiKeyResult?: MultiKeyTestResult;
  models?: string[];
}
