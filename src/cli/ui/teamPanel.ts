/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TeamPanel — real-time terminal display of multi-agent team progress.
 *
 * Subscribes to OrchestratorEvent and renders a live status panel showing
 * each agent's label, status icon, and a rolling preview of streaming output.
 * Uses terminal escape codes to update in place (no external deps).
 */
import type { OrchestratorEvent } from '@process/task/orchestrator/types';
import { fmt, clearLines, hr } from './format';

type AgentState = {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  preview: string;
  startedAt?: number;
};

export class TeamPanel {
  private agents = new Map<string, AgentState>();
  private lastLineCount = 0;
  private goal = '';
  private spinnerFrame = 0;
  private readonly SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  setGoal(goal: string): void {
    this.goal = goal;
  }

  setLabel(subTaskId: string, label: string): void {
    const agent = this.agents.get(subTaskId);
    if (agent) {
      agent.label = label;
    } else {
      this.agents.set(subTaskId, { label, status: 'pending', preview: '' });
    }
  }

  update(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'subtask:started': {
        const existing = this.agents.get(event.subTaskId);
        this.agents.set(event.subTaskId, {
          label: existing?.label ?? event.subTaskId,
          status: 'running',
          preview: '',
          startedAt: Date.now(),
        });
        break;
      }
      case 'subtask:progress': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) {
          // Keep a rolling 80-char (Unicode-safe) preview of streaming output
          const combined = (agent.preview + event.text).replace(/\n/g, ' ');
          agent.preview = Array.from(combined).slice(-80).join('');
        }
        break;
      }
      case 'subtask:done': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) agent.status = 'done';
        break;
      }
      case 'subtask:failed': {
        const agent = this.agents.get(event.subTaskId);
        if (agent) {
          agent.status = 'failed';
          agent.preview = event.error;
        }
        break;
      }
      case 'orchestrator:failed': {
        // Mark any still-running or pending agents as cancelled
        for (const agent of this.agents.values()) {
          if (agent.status === 'running' || agent.status === 'pending') {
            agent.status = 'cancelled';
          }
        }
        break;
      }
    }
    this.spinnerFrame++;
    this.render();
  }

  render(): void {
    if (this.lastLineCount > 0) {
      clearLines(this.lastLineCount);
    }

    const lines: string[] = [];

    if (this.goal) {
      lines.push(`${fmt.bold('Goal:')} ${fmt.cyan(this.goal)}`);
      lines.push(fmt.dim(hr()));
    }

    for (const [id, state] of this.agents) {
      const label = fmt.bold(state.label || id);

      let coloredIcon: string;
      let statusSuffix = '';

      if (state.status === 'running') {
        const spin = this.SPIN[this.spinnerFrame % this.SPIN.length]!;
        coloredIcon = fmt.cyan(spin);
        if (state.startedAt !== undefined) {
          const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
          statusSuffix = ' ' + fmt.dim(`${elapsed}s`);
        }
      } else if (state.status === 'done') {
        coloredIcon = fmt.green('✓');
      } else if (state.status === 'failed') {
        coloredIcon = fmt.red('✗');
      } else if (state.status === 'cancelled') {
        coloredIcon = fmt.yellow('⊘');
        statusSuffix = ' ' + fmt.dim('已取消');
      } else {
        coloredIcon = fmt.dim('○');
        statusSuffix = ' ' + fmt.dim('等待中');
      }

      let preview = '';
      if (state.status === 'failed' && state.preview) {
        preview = fmt.dim(' ' + Array.from(state.preview).slice(0, 50).join('').trim());
      } else if (state.preview) {
        preview = fmt.dim(' ' + state.preview.slice(0, 60).trim());
      }

      lines.push(`  ${coloredIcon} ${label}${statusSuffix}${preview}`);
    }

    if (lines.length > 0) {
      process.stdout.write(lines.join('\n') + '\n');
    }
    this.lastLineCount = lines.length;
  }

  clear(): void {
    if (this.lastLineCount > 0) {
      clearLines(this.lastLineCount);
      this.lastLineCount = 0;
    }
  }
}
