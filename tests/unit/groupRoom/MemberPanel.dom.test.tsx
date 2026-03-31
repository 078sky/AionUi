/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// ---------------------------------------------------------------------------
// Hoisted mocks -- must come before any imports
// ---------------------------------------------------------------------------

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
    i18n: { language: 'en-US' },
  }),
}));

const mockUseGroupRoom = vi.fn(() => ({
  room: null,
  members: [] as GroupMember[],
  messages: [],
  isRunning: false,
  inputLocked: false,
}));

vi.mock('@renderer/pages/group-room/context/GroupRoomContext', () => ({
  useGroupRoomContext: (...args: unknown[]) => mockUseGroupRoom(...args),
  useGroupRoom: (...args: unknown[]) => mockUseGroupRoom(...args),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: () => <div data-testid='virtuoso-list' />,
}));

vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children?: string }) => <div>{children}</div>,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { GroupMember, GroupMessage } from '@renderer/pages/group-room/types';
import MemberPanel from '@renderer/pages/group-room/components/MemberPanel';
import AgentTabContent from '@renderer/pages/group-room/components/AgentTabContent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMember(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    id: 'member-1',
    displayName: 'Alice',
    agentType: 'architect',
    role: 'host',
    status: 'idle',
    currentTask: null,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 'msg-1',
    msgKind: 'sub_output',
    senderId: 'member-1',
    senderName: 'Alice',
    targetId: null,
    targetName: null,
    senderRole: 'host',
    content: 'hello',
    streaming: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MemberPanel Tests
// ---------------------------------------------------------------------------

describe('MemberPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });
  });

  // Case 12-1: empty state
  it('shows "暂无成员" when members list is empty', () => {
    render(<MemberPanel />);
    expect(screen.getByText('暂无成员')).toBeInTheDocument();
  });

  // Case 12-2: host / sub role badges
  it('shows "群主" badge for host and "成员" badge for sub', () => {
    const host = makeMember({ id: 'h1', displayName: 'Host', role: 'host' });
    const sub = makeMember({ id: 's1', displayName: 'Sub', role: 'sub' });
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [host, sub],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    render(<MemberPanel />);
    expect(screen.getByText('群主')).toBeInTheDocument();
    // "成员" appears both as header title and as role badge; verify at least the badge exists
    const memberTexts = screen.getAllByText('成员');
    expect(memberTexts.length).toBeGreaterThanOrEqual(2); // title + role badge
  });

  // Case 12-3: displayName renders correctly
  it('renders member displayName', () => {
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [makeMember({ displayName: 'Charlie' })],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    render(<MemberPanel />);
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  // Case 12-4: currentTask text
  it('shows currentTask text when present', () => {
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [makeMember({ currentTask: 'Reviewing PR #42' })],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    render(<MemberPanel />);
    expect(screen.getByText('Reviewing PR #42')).toBeInTheDocument();
  });

  // Case 12-5: member count
  it('displays member count number', () => {
    const m1 = makeMember({ id: 'a', displayName: 'A' });
    const m2 = makeMember({ id: 'b', displayName: 'B', role: 'sub' });
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [m1, m2],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    render(<MemberPanel />);
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  // Case 15: dynamic join -- members change from 1 to 2
  it('renders new member after rerender with updated members', () => {
    const m1 = makeMember({ id: 'a', displayName: 'Alpha', agentType: 'architect' });
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [m1],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    const { rerender } = render(<MemberPanel />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();

    const m2 = makeMember({
      id: 'b',
      displayName: 'Beta',
      agentType: 'developer',
      role: 'sub',
    });
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [m1, m2],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    rerender(<MemberPanel />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  // Case 19: status badge classes
  it('renders processing badge for running status', () => {
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [makeMember({ status: 'running' })],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    const { container } = render(<MemberPanel />);
    expect(container.querySelector('.arco-badge-status-processing')).toBeInTheDocument();
  });

  it('renders success badge for finished status', () => {
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [makeMember({ status: 'finished' })],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    const { container } = render(<MemberPanel />);
    expect(container.querySelector('.arco-badge-status-success')).toBeInTheDocument();
  });

  it('renders error badge for error status', () => {
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [makeMember({ status: 'error' })],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    const { container } = render(<MemberPanel />);
    expect(container.querySelector('.arco-badge-status-error')).toBeInTheDocument();
  });

  // Avatar initial letter
  it('renders uppercase initial of displayName as avatar', () => {
    mockUseGroupRoom.mockReturnValue({
      room: null,
      members: [makeMember({ displayName: 'xiao' })],
      messages: [],
      isRunning: false,
      inputLocked: false,
    });

    render(<MemberPanel />);
    expect(screen.getByText('X')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AgentTabContent Tests
// ---------------------------------------------------------------------------

describe('AgentTabContent', () => {
  // Case 16-1: empty messages
  it('shows "暂无消息" when messages is empty', () => {
    render(<AgentTabContent messages={[]} members={[]} />);
    expect(screen.getByText('暂无消息')).toBeInTheDocument();
  });

  // Case 16-2: has messages -- no empty placeholder
  it('does not show "暂无消息" when messages exist', () => {
    render(<AgentTabContent messages={[makeMessage()]} members={[makeMember()]} />);
    expect(screen.queryByText('暂无消息')).not.toBeInTheDocument();
  });

  // Case 18 (partial): read-only -- no textarea
  it('does not render a textarea (read-only)', () => {
    const { container } = render(<AgentTabContent messages={[]} members={[]} />);
    expect(container.querySelector('textarea')).toBeNull();
  });
});
