/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { loadConfig } from '../config/loader';
import { fmt, hr } from '../ui/format';

function checkBin(bin: string): { ok: boolean; version: string } {
  try {
    const v = execSync(`${bin} --version 2>&1`, { encoding: 'utf-8' }).trim().split('\n')[0];
    return { ok: true, version: v ?? '' };
  } catch {
    return { ok: false, version: '' };
  }
}

/** Known installable CLI agents in the Aion ecosystem */
const KNOWN_CLI_AGENTS: Array<{
  key: string;
  bin: string;
  install: string;
  description: string;
}> = [
  {
    key: 'claude',
    bin: 'claude',
    install: 'brew install anthropics/tap/claude-code',
    description: 'Claude Code (Anthropic)',
  },
  {
    key: 'codex',
    bin: 'codex',
    install: 'npm install -g @openai/codex',
    description: 'Codex CLI (OpenAI)',
  },
];

/** Known API-key-based providers */
const KNOWN_API_AGENTS: Array<{
  key: string;
  envVars: string[];
  description: string;
  models: string;
}> = [
  {
    key: 'claude (API)',
    envVars: ['ANTHROPIC_API_KEY'],
    description: 'Direct Anthropic SDK',
    models: 'claude-opus-4-6, claude-sonnet-4-6, ...',
  },
  {
    key: 'gemini',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    description: 'Direct Gemini SDK',
    models: 'gemini-2.0-flash, gemini-1.5-pro, ...',
  },
];

export async function runDoctor(): Promise<void> {
  process.stdout.write(`\n${fmt.bold('Aion 环境检查')}\n\n`);

  const config = loadConfig();

  // ── Active agents ─────────────────────────────────────────────────────────
  process.stdout.write(fmt.bold('已配置的 Agent：\n'));

  if (Object.keys(config.agents).length === 0) {
    process.stdout.write(fmt.yellow('  (none configured)\n'));
  } else {
    for (const [name, agent] of Object.entries(config.agents)) {
      const isDefault = name === config.defaultAgent ? fmt.green(' [default]') : '';

      if (agent.provider === 'claude-cli' || agent.provider === 'codex-cli') {
        const bin = agent.bin ?? agent.provider.replace('-cli', '');
        const check = checkBin(bin);
        const status = check.ok
          ? fmt.green(`✓ ${check.version}`)
          : fmt.red('✗ 未找到：' + bin);
        process.stdout.write(
          `  ${fmt.green('●')} ${fmt.cyan(name)}${isDefault}  ${fmt.dim(bin)}  ${status}\n`,
        );
      } else {
        const hasKey = !!agent.apiKey;
        const keyStatus = hasKey ? fmt.green('✓ 已配置密钥') : fmt.yellow('⚠ 未配置密钥');
        process.stdout.write(
          `  ${hasKey ? fmt.green('●') : fmt.yellow('◐')} ${fmt.cyan(name)}${isDefault}  ${fmt.dim(`${agent.provider}/${agent.model ?? '?'}`)}  ${keyStatus}\n`,
        );
      }
    }
  }

  // ── Installable CLI agents not yet set up ─────────────────────────────────
  const missingCli = KNOWN_CLI_AGENTS.filter(({ key }) => !config.agents[key]);

  if (missingCli.length > 0) {
    process.stdout.write(
      '\n' +
        fmt.bold('可用 CLI Agent（未安装）：\n') +
        `  ${fmt.dim('(可选) 安装以获得更好的体验')}\n`,
    );
    for (const { key, bin, install, description } of missingCli) {
      const found = checkBin(bin);
      if (found.ok) {
        // Binary exists but not in config — auto-detect would pick it up on restart
        process.stdout.write(
          `  ${fmt.yellow('○')} ${fmt.cyan(key)}  ${fmt.dim(description)}  ${fmt.dim('(已安装，重启 aion 可自动激活)')}\n`,
        );
      } else {
        process.stdout.write(
          `  ${fmt.dim('○')} ${fmt.dim(key)}  ${fmt.dim(description)}\n` +
            `     安装：${fmt.cyan(install)}\n`,
        );
      }
    }
  }

  // ── API key agents not yet set up ─────────────────────────────────────────
  const missingApi = KNOWN_API_AGENTS.filter(({ key, envVars }) => {
    const baseKey = key.replace(' (API)', '');
    return !config.agents[baseKey] && !envVars.some((v) => !!process.env[v]);
  });

  if (missingApi.length > 0) {
    process.stdout.write(
      '\n' +
        fmt.bold('可用 API Agent（未配置密钥）：\n') +
        `  ${fmt.dim('(可选) 配置 API Key 以直接调用 API')}\n`,
    );
    for (const { envVars, description, models } of missingApi) {
      process.stdout.write(
        `  ${fmt.dim('○')} ${fmt.dim(description)}  ${fmt.dim(`(${models})`)}\n` +
          `     配置：${fmt.cyan(`export ${envVars[0]}=...`)}\n`,
      );
    }
  }

  // ── Multi-model team potential ────────────────────────────────────────────
  const agentCount = Object.keys(config.agents).length;
  process.stdout.write('\n' + fmt.bold('多模型团队状态：\n'));
  if (agentCount >= 2) {
    process.stdout.write(
      `  ${fmt.green('✓')} 已配置 ${agentCount} 个 Agent — 多模型团队已就绪\n`,
    );
    process.stdout.write(
      `  ${fmt.dim(`aion team --goal "..." --with ${Object.keys(config.agents).slice(0, 3).join(',')}`)}\n`,
    );
  } else if (agentCount === 1) {
    process.stdout.write(
      `  ${fmt.yellow('⚠')} 仅配置了 1 个 Agent — 团队协作将使用相同模型\n`,
    );
    process.stdout.write(
      `  ${fmt.dim('添加第二个 Agent 可解锁混合模型协作')}\n`,
    );
  } else {
    process.stdout.write(`  ${fmt.red('✗')} 未配置任何 Agent — 无法运行\n`);
  }

  // ── Quick usage ───────────────────────────────────────────────────────────
  process.stdout.write('\n' + fmt.bold('快速使用：\n'));
  process.stdout.write(
    `  ${fmt.cyan('aion')}                                 ${fmt.dim('交互式对话')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('aion team --goal "..."')}              ${fmt.dim('3 Agent 团队（角色自动推断）')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('aion team --goal "..." --with a,b,c')}  ${fmt.dim('指定混合模型团队')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('aion run "任务描述"')}                  ${fmt.dim('一次性执行，无 REPL')}\n`,
  );
  process.stdout.write(
    `  ${fmt.cyan('aion -a codex')}                       ${fmt.dim('指定 Agent 单独对话')}\n`,
  );
  process.stdout.write(
    '\n' + fmt.dim(hr()) + '\n',
  );
  process.stdout.write(
    fmt.dim(`配置文件：~/.aion/config.json  ·  运行 \`aion config\` 查看详情\n\n`),
  );
}
