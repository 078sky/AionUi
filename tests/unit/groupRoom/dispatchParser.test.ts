/**
 * Tests for dispatchParser: parseDispatchInstructions + formatResultReport.
 * Covers Case 1 parsing foundations.
 */
import { describe, it, expect } from 'vitest';
import { parseDispatchInstructions, formatResultReport } from '@process/services/groupRoom/dispatchParser';
import type { DispatchInstruction, SubAgentResult } from '@process/services/groupRoom/dispatchParser';

// ==========================================
// parseDispatchInstructions
// ==========================================

describe('parseDispatchInstructions', () => {
  it('parses self-closing agent with id (existing member)', () => {
    const raw = `
Analysis complete.
<dispatch>
  <agent id="agent-001" description="implement prime" prompt="implement isPrime(n)"/>
</dispatch>
    `;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      agentId: 'agent-001',
      description: 'implement prime',
      prompt: 'implement isPrime(n)',
    });
  });

  it('parses description+type dynamic format', () => {
    const raw = `
<dispatch>
  <agent type="claude" description="sorter" prompt="write a sorting function"/>
</dispatch>
    `;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'claude',
      description: 'sorter',
      prompt: 'write a sorting function',
    });
  });

  it('parses mixed formats in one block', () => {
    const raw = `
<dispatch>
  <agent id="existing-agent" description="review code" prompt="review the code"/>
  <agent type="gemini" description="API designer" prompt="design API interface"/>
</dispatch>
    `;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ agentId: 'existing-agent', prompt: 'review the code' });
    expect(result[1]).toMatchObject({ type: 'gemini', description: 'API designer', prompt: 'design API interface' });
  });

  it('filters out dispatch inside code blocks', () => {
    const raw = `
This is an explanation.
\`\`\`xml
<dispatch>
  <agent id="should-be-ignored" description="ignored" prompt="should not be parsed"/>
</dispatch>
\`\`\`

<dispatch>
  <agent id="real-agent" description="real task" prompt="real task content"/>
</dispatch>
    `;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ agentId: 'real-agent' });
  });

  it('truncates to max 5 agents', () => {
    const agents = Array.from(
      { length: 8 },
      (_, i) => `<agent type="claude" description="agent-${i}" prompt="task ${i}"/>`
    ).join('\n');
    const raw = `<dispatch>\n${agents}\n</dispatch>`;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(5);
    expect(result[4]).toMatchObject({ description: 'agent-4' });
  });

  it('returns empty array for no dispatch block', () => {
    const raw = 'No dispatch tags here.';
    const result = parseDispatchInstructions(raw);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseDispatchInstructions('')).toEqual([]);
  });

  it('skips agents with empty prompt', () => {
    const raw = `
<dispatch>
  <agent id="a1" description="empty" prompt="   "/>
  <agent id="a2" description="valid" prompt="valid task"/>
</dispatch>
    `;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ agentId: 'a2' });
  });

  it('only uses the first dispatch block', () => {
    const raw = `
<dispatch>
  <agent id="first" description="first task" prompt="first"/>
</dispatch>
<dispatch>
  <agent id="second" description="second task" prompt="second"/>
</dispatch>
    `;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ agentId: 'first' });
  });

  it('parses paired agent elements with body as prompt', () => {
    const raw = `
<dispatch>
  <agent description="detailed task">This is a very long prompt that is easier to write as body text.</agent>
</dispatch>
    `;
    const result = parseDispatchInstructions(raw);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('This is a very long prompt that is easier to write as body text.');
    expect(result[0].description).toBe('detailed task');
  });
});

// ==========================================
// formatResultReport
// ==========================================

describe('formatResultReport', () => {
  it('produces correct plain text for single result', () => {
    const results: SubAgentResult[] = [
      { agentName: 'Coder', status: 'success', content: 'function add(a,b){return a+b}' },
    ];
    const report = formatResultReport(results);
    expect(report).toContain('[Agent "Coder" completed]');
    expect(report).toContain('function add(a,b){return a+b}');
  });

  it('produces correct plain text for multiple results', () => {
    const results: SubAgentResult[] = [
      { agentName: 'A', status: 'success', content: 'ok' },
      { agentName: 'B', status: 'error', content: 'failed' },
    ];
    const report = formatResultReport(results);
    expect(report).toContain('[Agent "A" completed]');
    expect(report).toContain('[Agent "B" error]');
    expect(report).toContain('ok');
    expect(report).toContain('failed');
  });

  it('handles special characters in agent name and content', () => {
    const results: SubAgentResult[] = [
      { agentName: 'agent<1>', status: 'success', content: 'a < b && c > d "quoted"' },
    ];
    const report = formatResultReport(results);
    // Plain text format — no escaping needed
    expect(report).toContain('[Agent "agent<1>" completed]');
    expect(report).toContain('a < b && c > d "quoted"');
  });

  it('produces empty string for empty results array', () => {
    const report = formatResultReport([]);
    expect(report).toBe('');
  });
});
