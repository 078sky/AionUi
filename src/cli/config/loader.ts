/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AionCliConfig, AgentConfig } from './types';

export const CONFIG_DIR = join(homedir(), '.aion');
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// ── Auto-detection ──────────────────────────────────────────────────────────

/** Find a CLI binary via `which`. Returns null if not found. */
function findBin(name: string): string | null {
  try {
    return execFileSync('which', [name], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect locally installed CLI agents.
 * These use their own stored credentials — no API keys needed.
 */
function detectCliAgents(): Record<string, AgentConfig> {
  const agents: Record<string, AgentConfig> = {};

  const claudeBin = findBin('claude');
  if (claudeBin) {
    agents['claude'] = { provider: 'claude-cli', bin: claudeBin };
  }

  const codexBin = findBin('codex');
  if (codexBin) {
    agents['codex'] = { provider: 'codex-cli', bin: codexBin };
  }

  return agents;
}

/**
 * Apply API-key env var overrides for direct SDK usage.
 * These supplement (not replace) detected CLI agents.
 */
function applyEnvOverrides(agents: Record<string, AgentConfig>): Record<string, AgentConfig> {
  const result = { ...agents };

  // Anthropic SDK: only add if no claude-cli already detected
  if (process.env.ANTHROPIC_API_KEY && !result['claude']) {
    result['claude'] = {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  if ((process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY) && !result['gemini']) {
    result['gemini'] = {
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    };
  }

  return result;
}

// ── Config loading ───────────────────────────────────────────────────────────

function loadFileConfig(): Partial<AionCliConfig> {
  if (!existsSync(CONFIG_FILE)) return {};
  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[aion] 无法读取配置文件 ${CONFIG_FILE}：${String(err)}\n` +
        `[aion] 请运行 \`aion doctor\` 检查配置状态\n`,
    );
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[aion] 配置文件 JSON 语法错误（${CONFIG_FILE}）：${String(err)}\n` +
        `[aion] 请修复该文件或删除后重新运行 \`aion doctor\`\n`,
    );
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    process.stderr.write(
      `[aion] 配置文件格式无效（${CONFIG_FILE}）：顶层应为 JSON 对象\n`,
    );
    return {};
  }
  const KNOWN_KEYS = new Set(['defaultAgent', 'agents', 'team']);
  const invalidKeys = Object.keys(parsed).filter((k) => !KNOWN_KEYS.has(k));
  if (invalidKeys.length > 0) {
    process.stderr.write(
      `[aion] 配置文件包含未知字段：${invalidKeys.join(', ')}\n` +
        `[aion] 有效字段为：${[...KNOWN_KEYS].join(', ')}\n`,
    );
  }
  return parsed as Partial<AionCliConfig>;
}

export function loadConfig(): AionCliConfig {
  const fileConfig = loadFileConfig();

  // Start with auto-detected CLI agents, then apply env overrides, then merge
  // file config on top (file config wins for explicit settings)
  const detectedAgents = detectCliAgents();
  const withEnvAgents = applyEnvOverrides(detectedAgents);
  const agents = { ...withEnvAgents, ...fileConfig.agents };

  // Pick default: prefer claude if available, otherwise first detected
  let defaultAgent = fileConfig.defaultAgent ?? '';
  if (!defaultAgent || !agents[defaultAgent]) {
    defaultAgent = agents['claude'] ? 'claude' : (Object.keys(agents)[0] ?? 'claude');
  }

  return {
    defaultAgent,
    agents,
    team: fileConfig.team,
  };
}

export function saveConfig(config: AionCliConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
