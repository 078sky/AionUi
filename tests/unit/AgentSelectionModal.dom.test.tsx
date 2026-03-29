/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for AgentSelectionModal component (S5: New Conversation Flow)
 *
 * Written SPEC-FIRST against tech-design.md Acceptance Criteria.
 * Component lives at:
 *   src/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.tsx
 *
 * Covered ACs:
 *   AC-2  — Clicking "+" button opens the modal (tested via visible prop)
 *   AC-3  — Modal renders agents partitioned into "Saved Assistants" (permanent) and "CLI Agents" (temporary)
 *   AC-4  — Each agent card shows avatar (emoji/logo/letter fallback), name, and source label
 *   AC-5  — Search input filters agents by name (case-insensitive, client-side)
 *   AC-6  — Clicking an agent card calls onSelect with the agent's id, then closes modal
 *   AC-7  — Clicking outside (onCancel) or pressing Escape calls onClose without navigation
 *   AC-8  — Search input resets when modal closes (visible goes false → true)
 *   AC-17 — All user-facing strings use i18n keys (no hardcoded text)
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ----------------------------------------------------------------- //

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@icon-park/react', () => ({
  Search: (props: Record<string, unknown>) => <span data-testid='icon-search' {...props} />,
}));

// Arco Modal mock: renders children when visible, calls onCancel on backdrop click
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Modal: ({
      visible,
      title,
      onCancel,
      children,
      footer: _footer,
    }: {
      visible: boolean;
      title?: React.ReactNode;
      onCancel?: () => void;
      children?: React.ReactNode;
      footer?: React.ReactNode;
    }) =>
      visible ? (
        <div data-testid='agent-selection-modal'>
          <div data-testid='modal-title'>{title}</div>
          <button data-testid='modal-cancel-btn' onClick={onCancel}>
            close
          </button>
          {children}
        </div>
      ) : null,
    Input: ({
      value,
      onChange,
      placeholder,
    }: {
      value?: string;
      onChange?: (v: string) => void;
      placeholder?: string;
    }) => (
      <input
        data-testid='agent-search-input'
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal.module.css', () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import type { AgentIdentity } from '@/renderer/utils/model/agentIdentity';
import AgentSelectionModal from '@/renderer/pages/conversation/GroupedHistory/components/AgentSelectionModal';
import type { AgentSelectionModalProps } from '@/renderer/pages/conversation/GroupedHistory/types';

// --- Fixtures -------------------------------------------------------------- //

const makeAgent = (
  id: string,
  name: string,
  employeeType: 'permanent' | 'temporary',
  source: AgentIdentity['source'],
  avatar?: string
): AgentIdentity => ({
  id,
  name,
  employeeType,
  source,
  avatar,
});

const PERMANENT_AGENTS: AgentIdentity[] = [
  makeAgent('preset:word-creator', 'Word Creator', 'permanent', 'preset', '📝'),
  makeAgent('custom:abc123', 'My Custom Agent', 'permanent', 'custom'),
  makeAgent('custom:dispatch1', 'Dispatch Teammate', 'permanent', 'dispatch_teammate', '🤖'),
];

const TEMPORARY_AGENTS: AgentIdentity[] = [
  makeAgent('claude', 'Claude', 'temporary', 'cli_agent'),
  makeAgent('gemini', 'Gemini', 'temporary', 'cli_agent'),
  makeAgent('codex', 'Codex', 'temporary', 'cli_agent'),
];

const ALL_AGENTS: AgentIdentity[] = [...PERMANENT_AGENTS, ...TEMPORARY_AGENTS];

const defaultProps = (): AgentSelectionModalProps => ({
  visible: true,
  agents: ALL_AGENTS,
  onSelect: vi.fn(),
  onClose: vi.fn(),
});

// --- Tests ----------------------------------------------------------------- //

describe('AgentSelectionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  // ASM-001: AC-2 — Modal renders when visible=true
  it('ASM-001 (AC-2): renders the modal when visible is true', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByTestId('agent-selection-modal')).toBeInTheDocument();
  });

  // ASM-002: AC-2 — Modal is absent from DOM when visible=false
  it('ASM-002 (AC-2): does not render the modal when visible is false', () => {
    render(<AgentSelectionModal {...defaultProps()} visible={false} />);

    expect(screen.queryByTestId('agent-selection-modal')).not.toBeInTheDocument();
  });

  // ASM-003: AC-17 — Modal title uses i18n key (not hardcoded "Select an agent")
  it('ASM-003 (AC-17): modal title uses i18n key dispatch.sidebar.selectAgent', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByTestId('modal-title')).toHaveTextContent('dispatch.sidebar.selectAgent');
    expect(screen.queryByText('Select an agent')).not.toBeInTheDocument();
  });

  // ── Agent list partitioning ───────────────────────────────────────────────

  // ASM-004: AC-3 — "Saved Assistants" section header appears for permanent agents
  it('ASM-004 (AC-3): renders "Saved Assistants" section header via i18n key', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByText('dispatch.sidebar.permanentAgents')).toBeInTheDocument();
  });

  // ASM-005: AC-3 — "CLI Agents" section header appears for temporary agents
  it('ASM-005 (AC-3): renders "CLI Agents" section header via i18n key', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByText('dispatch.sidebar.temporaryAgents')).toBeInTheDocument();
  });

  // ASM-006: AC-3 — All permanent agents are rendered
  it('ASM-006 (AC-3): renders all permanent agents by name', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByText('Word Creator')).toBeInTheDocument();
    expect(screen.getByText('My Custom Agent')).toBeInTheDocument();
    expect(screen.getByText('Dispatch Teammate')).toBeInTheDocument();
  });

  // ASM-007: AC-3 — All temporary agents are rendered
  it('ASM-007 (AC-3): renders all temporary (CLI) agents by name', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Gemini')).toBeInTheDocument();
    expect(screen.getByText('Codex')).toBeInTheDocument();
  });

  // ASM-008: AC-3 — Permanent agents section appears before temporary agents section
  it('ASM-008 (AC-3): permanent agents section appears before temporary agents section in DOM', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const permanentHeader = screen.getByText('dispatch.sidebar.permanentAgents');
    const temporaryHeader = screen.getByText('dispatch.sidebar.temporaryAgents');

    // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING = 4 means target is after reference
    expect(permanentHeader.compareDocumentPosition(temporaryHeader)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // ── Agent card content ────────────────────────────────────────────────────

  // ASM-009: AC-4 — Emoji avatar is shown when agent has an emoji avatar
  it('ASM-009 (AC-4): emoji avatar is displayed for agents with an emoji avatar', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByText('📝')).toBeInTheDocument();
    expect(screen.getByText('🤖')).toBeInTheDocument();
  });

  // ASM-010: AC-4 — Letter fallback is shown when agent has no avatar
  it('ASM-010 (AC-4): first letter of name is shown as fallback when agent has no avatar', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    // "My Custom Agent" has no avatar → expects "M" letter fallback
    // "Claude" has no avatar → expects "C" letter fallback
    // The letter fallback element is a character inside a dedicated fallback container.
    // We check the text node exists anywhere in the modal.
    const modal = screen.getByTestId('agent-selection-modal');
    // Use within to scope: letter fallback for "My Custom Agent" = "M"
    expect(within(modal).getByText('M')).toBeInTheDocument();
  });

  // ASM-011: AC-4 — Source badge is displayed for each agent card
  it('ASM-011 (AC-4): each agent card renders a source badge with the correct i18n key', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    // Source badge i18n keys: agentSourcePreset, agentSourceCustom, agentSourceCli
    // The mock t() returns keys as-is. We check at least one badge key appears.
    const modal = screen.getByTestId('agent-selection-modal');
    expect(within(modal).queryByText('dispatch.sidebar.agentSourcePreset')).not.toBeNull();
  });

  // ── Search/filter ─────────────────────────────────────────────────────────

  // ASM-012: AC-5 — Search input is present in the modal
  it('ASM-012 (AC-5): search input is rendered inside the modal', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.getByTestId('agent-search-input')).toBeInTheDocument();
  });

  // ASM-013: AC-5 — Search input placeholder uses i18n key
  it('ASM-013 (AC-17): search input placeholder uses i18n key dispatch.sidebar.searchAgents', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    expect(input).toHaveAttribute('placeholder', 'dispatch.sidebar.searchAgents');
  });

  // ASM-014: AC-5 — Typing "word" filters to show only "Word Creator"
  it('ASM-014 (AC-5): typing in search filters agents by name (case-insensitive)', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    fireEvent.change(input, { target: { value: 'word' } });

    expect(screen.getByText('Word Creator')).toBeInTheDocument();
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
    expect(screen.queryByText('My Custom Agent')).not.toBeInTheDocument();
  });

  // ASM-015: AC-5 — Search is case-insensitive ("CLAUDE" matches "Claude")
  it('ASM-015 (AC-5): search filtering is case-insensitive', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    fireEvent.change(input, { target: { value: 'CLAUDE' } });

    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.queryByText('Word Creator')).not.toBeInTheDocument();
  });

  // ASM-016: AC-5 — Search by agent id prefix
  it('ASM-016 (AC-5): search filters agents by id (partial match)', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    // "preset" matches the id "preset:word-creator"
    fireEvent.change(input, { target: { value: 'preset' } });

    expect(screen.getByText('Word Creator')).toBeInTheDocument();
    // CLI agents whose ids don't contain "preset" should be hidden
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
  });

  // ASM-017: AC-5 — Empty search query shows all agents
  it('ASM-017 (AC-5): clearing search query restores full agent list', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    fireEvent.change(input, { target: { value: 'word' } });
    fireEvent.change(input, { target: { value: '' } });

    expect(screen.getByText('Word Creator')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Gemini')).toBeInTheDocument();
  });

  // ASM-018: Empty search results — no agent cards visible, sections may be empty
  it('ASM-018: no agents are shown when search query matches nothing', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    fireEvent.change(input, { target: { value: 'zzznomatch' } });

    expect(screen.queryByText('Word Creator')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
    expect(screen.queryByText('My Custom Agent')).not.toBeInTheDocument();
  });

  // ── Agent selection ───────────────────────────────────────────────────────

  // ASM-019: AC-6 — Clicking an agent card calls onSelect with the agent's id
  it('ASM-019 (AC-6): clicking an agent card calls onSelect with the agent id', () => {
    const onSelect = vi.fn();
    render(<AgentSelectionModal {...defaultProps()} onSelect={onSelect} />);

    // Click the "Word Creator" agent card
    const agentCard =
      screen.queryByTestId('agent-card-preset:word-creator') ??
      screen.getByText('Word Creator').closest('[role="button"]') ??
      screen.getByText('Word Creator').closest('[data-testid*="agent-card"]') ??
      screen.getByText('Word Creator').parentElement;

    expect(agentCard).not.toBeNull();
    fireEvent.click(agentCard!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('preset:word-creator');
  });

  // ASM-020: AC-6 — Clicking a CLI agent card calls onSelect with the backend id
  it('ASM-020 (AC-6): clicking a CLI agent card calls onSelect with the CLI agent id', () => {
    const onSelect = vi.fn();
    render(<AgentSelectionModal {...defaultProps()} onSelect={onSelect} />);

    const agentCard =
      screen.queryByTestId('agent-card-claude') ??
      screen.getByText('Claude').closest('[role="button"]') ??
      screen.getByText('Claude').closest('[data-testid*="agent-card"]') ??
      screen.getByText('Claude').parentElement;

    expect(agentCard).not.toBeNull();
    fireEvent.click(agentCard!);

    expect(onSelect).toHaveBeenCalledWith('claude');
  });

  // ASM-021: AC-7 — Clicking the modal cancel (Escape / backdrop) calls onClose
  it('ASM-021 (AC-7): clicking the modal close button calls onClose', () => {
    const onClose = vi.fn();
    render(<AgentSelectionModal {...defaultProps()} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('modal-cancel-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ASM-022: AC-7 — onSelect is NOT called when the modal is dismissed without selection
  it('ASM-022 (AC-7): onSelect is not called when modal is dismissed without selecting an agent', () => {
    const onSelect = vi.fn();
    render(<AgentSelectionModal {...defaultProps()} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId('modal-cancel-btn'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  // ── Search reset on close ─────────────────────────────────────────────────

  // ASM-023: AC-8 — Search query is cleared when modal closes (visible: true → false → true)
  it('ASM-023 (AC-8): search input resets to empty when modal closes and reopens', () => {
    const { rerender } = render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    fireEvent.change(input, { target: { value: 'word' } });
    expect(input).toHaveValue('word');

    // Close the modal
    rerender(<AgentSelectionModal {...defaultProps()} visible={false} />);
    // Reopen the modal
    rerender(<AgentSelectionModal {...defaultProps()} visible={true} />);

    expect(screen.getByTestId('agent-search-input')).toHaveValue('');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  // ASM-024: Empty agents array — renders without crash
  it('ASM-024: renders without error when agents array is empty', () => {
    expect(() => render(<AgentSelectionModal {...defaultProps()} agents={[]} />)).not.toThrow();
  });

  // ASM-025: Only permanent agents — temporary section may not render or be empty
  it('ASM-025: renders correctly when all agents are permanent (no temporary agents)', () => {
    render(<AgentSelectionModal {...defaultProps()} agents={PERMANENT_AGENTS} />);

    expect(screen.getByText('dispatch.sidebar.permanentAgents')).toBeInTheDocument();
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
  });

  // ASM-026: Only temporary agents — permanent section may not render or be empty
  it('ASM-026: renders correctly when all agents are temporary (no permanent agents)', () => {
    render(<AgentSelectionModal {...defaultProps()} agents={TEMPORARY_AGENTS} />);

    expect(screen.getByText('dispatch.sidebar.temporaryAgents')).toBeInTheDocument();
    expect(screen.queryByText('Word Creator')).not.toBeInTheDocument();
  });

  // ASM-027: Failure path — onSelect is NOT triggered on render (no accidental side effects)
  it('ASM-027: onSelect and onClose are not called on initial render', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<AgentSelectionModal {...defaultProps()} onSelect={onSelect} onClose={onClose} />);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // ASM-028: AC-17 — No hardcoded "Select an agent" English string
  it('ASM-028 (AC-17): "Select an agent" is not hardcoded as English text', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.queryByText('Select an agent')).not.toBeInTheDocument();
  });

  // ASM-029: AC-17 — No hardcoded "Search agents..." English string
  it('ASM-029 (AC-17): "Search agents..." is not hardcoded as English placeholder', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    const input = screen.getByTestId('agent-search-input');
    expect(input.getAttribute('placeholder')).not.toBe('Search agents...');
  });

  // ASM-030: AC-17 — No hardcoded "Saved Assistants" English string
  it('ASM-030 (AC-17): "Saved Assistants" section header is not hardcoded English', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.queryByText('Saved Assistants')).not.toBeInTheDocument();
  });

  // ASM-031: AC-17 — No hardcoded "CLI Agents" English string
  it('ASM-031 (AC-17): "CLI Agents" section header is not hardcoded English', () => {
    render(<AgentSelectionModal {...defaultProps()} />);

    expect(screen.queryByText('CLI Agents')).not.toBeInTheDocument();
  });
});
