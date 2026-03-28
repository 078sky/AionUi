/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Solo command — interactive multi-turn chat.
 *
 * Design:
 *   - NO interactive selector before REPL (eliminates double-readline / Warp stdin bug)
 *   - Agent list shown passively on startup; use /model or -a to switch
 *   - Single readline lifecycle: startRepl owns stdin from the start
 */
import { loadConfig } from '../config/loader';
import { createCliAgentFactory } from '../agents/factory';
import { startRepl } from '../ui/repl';
import { fmt, hr } from '../ui/format';
import type { AionCliConfig } from '../config/types';
import type { IAgentManager } from '@process/task/IAgentManager';
import type { IAgentEventEmitter, AgentMessageEvent } from '@process/task/IAgentEventEmitter';

const VERSION = '1.9.2';

const LOGO_LINES = [
  '    _   ___ ___  _  _ ',
  '   /_\\  |_ _/ _ \\| \\| |',
  '  / _ \\  | | (_) | .` |',
  ' /_/ \\_\\|___\\___/|_|\\_|',
];

// ── Emitter ───────────────────────────────────────────────────────────────────

function makeStdoutEmitter(): IAgentEventEmitter {
  return {
    emitConfirmationAdd: () => {},
    emitConfirmationUpdate: () => {},
    emitConfirmationRemove: () => {},
    emitMessage(_cid: string, event: AgentMessageEvent) {
      if (event.type === 'text') {
        process.stdout.write((event.data as { content?: string })?.content ?? '');
      } else if (event.type === 'status') {
        if ((event.data as { status?: string })?.status === 'done') {
          process.stdout.write('\n\n');
        }
      }
    },
  };
}

// ── Display ───────────────────────────────────────────────────────────────────

function printLogo(config: AionCliConfig): void {
  const n = Object.keys(config.agents).length;
  process.stdout.write('\n');
  for (const line of LOGO_LINES) process.stdout.write(fmt.cyan(line) + '\n');
  process.stdout.write(
    `  ${fmt.dim('Multi-Model Agent Platform')}  ${fmt.dim('·')}  ${fmt.dim(`v${VERSION}`)}  ${fmt.dim('·')}  ${fmt.green(`${n} agent${n !== 1 ? 's' : ''} ready`)}\n`,
  );
  process.stdout.write(fmt.dim(hr()) + '\n');
}

function printOnboarding(): void {
  process.stdout.write('\n');
  for (const line of LOGO_LINES) process.stdout.write(fmt.cyan(line) + '\n');
  process.stdout.write(fmt.dim('  Multi-Model Agent Platform\n\n'));
  process.stdout.write(fmt.bold('No agents detected.\n\n'));
  process.stdout.write(
    `  ${fmt.cyan('brew install anthropics/tap/claude-code')}   ${fmt.dim('# Claude Code CLI')}\n` +
      `  ${fmt.cyan('npm install -g @openai/codex')}              ${fmt.dim('# Codex CLI')}\n\n` +
      `  ${fmt.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}       ${fmt.dim('# Anthropic API')}\n` +
      `  ${fmt.cyan('export GEMINI_API_KEY=...')}                 ${fmt.dim('# Gemini API')}\n\n` +
      `Run ${fmt.cyan('aion doctor')} to verify.\n\n`,
  );
}

/** Show agent list passively — no readline, no prompt, no waiting */
function printAgentList(config: AionCliConfig, activeKey: string): void {
  const keys = Object.keys(config.agents);
  if (keys.length <= 1) return; // single agent: no noise

  process.stdout.write('\n');
  for (const key of keys) {
    const agent = config.agents[key]!;
    const isActive = key === activeKey;
    const provider =
      agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
        ? agent.provider
        : `${agent.provider}/${agent.model ?? '?'}`;
    process.stdout.write(
      `  ${isActive ? fmt.green('●') : fmt.dim('○')} ${isActive ? fmt.bold(fmt.cyan(key)) : fmt.cyan(key)}  ${fmt.dim(provider)}\n`,
    );
  }
  process.stdout.write(fmt.dim('\n  /model <name>  switch agent  ·  /help  all commands\n'));
}

function printActiveAgent(config: AionCliConfig, key: string): void {
  const agent = config.agents[key];
  if (!agent) return;
  const provider =
    agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
      ? agent.provider
      : `${agent.provider}/${agent.model ?? '?'}`;
  process.stdout.write(
    `\n${fmt.green('●')} ${fmt.bold(fmt.cyan(key))}  ${fmt.dim(provider)}\n${fmt.dim(hr())}\n\n`,
  );
}

// ── Slash commands ────────────────────────────────────────────────────────────

const SLASH_HELP = `
${fmt.bold('Commands:')}
  ${fmt.cyan('/model <name>')}   Switch agent  ${fmt.dim('(e.g. /model codex  or  /model 2)')}
  ${fmt.cyan('/agents')}         List all configured agents
  ${fmt.cyan('/team [goal]')}    Launch a multi-agent team
  ${fmt.cyan('/help')}           Show this
  ${fmt.cyan('/exit')}           Exit Aion
`.trim();

async function handleSlashCommand(
  input: string,
  config: AionCliConfig,
  agentKeyRef: { current: string },
  managerRef: { current: IAgentManager },
): Promise<{ handled: boolean; exit?: boolean }> {
  const [cmd, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();

  switch (cmd?.toLowerCase()) {
    case 'help':
      process.stdout.write('\n' + SLASH_HELP + '\n\n');
      return { handled: true };

    case 'agents': {
      const keys = Object.keys(config.agents);
      process.stdout.write('\n');
      for (const [i, key] of keys.entries()) {
        const agent = config.agents[key]!;
        const isActive = key === agentKeyRef.current;
        const provider =
          agent.provider === 'claude-cli' || agent.provider === 'codex-cli'
            ? agent.provider
            : `${agent.provider}/${agent.model ?? '?'}`;
        process.stdout.write(
          `  ${isActive ? fmt.green('●') : fmt.dim('○')} ${fmt.dim(`${i + 1}.`)} ${fmt.cyan(key)}  ${fmt.dim(provider)}${isActive ? fmt.dim('  ← active') : ''}\n`,
        );
      }
      process.stdout.write('\n');
      return { handled: true };
    }

    case 'model': {
      if (!arg) {
        process.stdout.write(fmt.yellow('Usage: /model <name>  e.g. /model codex\n'));
        return { handled: true };
      }
      const keys = Object.keys(config.agents);
      const byNum = parseInt(arg, 10);
      const resolvedKey =
        config.agents[arg] ? arg
        : !isNaN(byNum) && keys[byNum - 1] ? keys[byNum - 1]!
        : null;

      if (!resolvedKey) {
        process.stdout.write(fmt.red(`Agent "${arg}" not found. Type /agents to list.\n`));
        return { handled: true };
      }
      agentKeyRef.current = resolvedKey;
      const factory = createCliAgentFactory(config, undefined, resolvedKey);
      managerRef.current = factory(`solo-${Date.now()}`, '', makeStdoutEmitter());
      process.stdout.write(
        `${fmt.green(`Switched to ${fmt.bold(resolvedKey)}`)}\n${fmt.dim('New conversation.\n\n')}`,
      );
      return { handled: true };
    }

    case 'team': {
      const { runTeam } = await import('./team');
      await runTeam({ goal: arg || undefined });
      return { handled: true };
    }

    case 'exit':
    case 'quit':
      process.stdout.write(fmt.dim('Goodbye.\n'));
      return { handled: true, exit: true };

    default:
      return { handled: false };
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

type SoloOptions = { agent?: string; workspace?: string };

export async function runSolo(options: SoloOptions = {}): Promise<void> {
  const config = loadConfig();

  if (Object.keys(config.agents).length === 0) {
    printOnboarding();
    process.exit(1);
  }

  // Resolve active agent — no readline, no prompt
  const activeKey =
    options.agent && config.agents[options.agent]
      ? options.agent
      : config.defaultAgent;

  printLogo(config);
  printAgentList(config, activeKey);
  printActiveAgent(config, activeKey);

  const agentKeyRef = { current: activeKey };
  const emitter = makeStdoutEmitter();
  const managerRef: { current: IAgentManager } = {
    current: createCliAgentFactory(config, undefined, activeKey)(`solo-${Date.now()}`, '', emitter),
  };

  // Single readline lifecycle — owns stdin from here to EOF
  await startRepl(
    () => `${agentKeyRef.current} >`,
    async (input) => {
      if (input.startsWith('/')) {
        const result = await handleSlashCommand(input, config, agentKeyRef, managerRef);
        if (result.exit) process.exit(0);
        if (result.handled) return;
      }
      await managerRef.current.sendMessage({ content: input });
    },
  );
}
