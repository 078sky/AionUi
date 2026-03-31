/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ── Global polyfills (before any imports that use them) ─────────────────────

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

let uuidCounter = 0;
Object.defineProperty(globalThis, 'crypto', {
  value: { randomUUID: () => `mock-uuid-${++uuidCounter}` },
});

// ── Hoisted mock fns ────────────────────────────────────────────────────────

const mockRoomId = 'room-test-1';

const mockGet = vi.fn();
const mockSendMessage = vi.fn();
const mockStreamOn = vi.fn<(handler: Function) => () => void>(() => () => {});
const mockMemberOn = vi.fn<(handler: Function) => () => void>(() => () => {});
const mockTurnOn = vi.fn<(handler: Function) => () => void>(() => () => {});

// Captured handlers -- populated via beforeEach mockImplementation
let streamHandler: Function;
let memberHandler: Function;
let turnHandler: Function;

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useParams: () => ({ roomId: mockRoomId }),
}));

vi.mock('../../../src/common', () => ({
  ipcBridge: {
    groupRoom: {
      get: { invoke: (...args: unknown[]) => mockGet(...args) },
      sendMessage: { invoke: (...args: unknown[]) => mockSendMessage(...args) },
      responseStream: {
        on: (handler: Function) => {
          mockStreamOn(handler);
          return () => {};
        },
      },
      memberChanged: {
        on: (handler: Function) => {
          mockMemberOn(handler);
          return () => {};
        },
      },
      turnCompleted: {
        on: (handler: Function) => {
          mockTurnOn(handler);
          return () => {};
        },
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => (
    <div data-testid='virtuoso-list'>
      {(data ?? []).map((item: unknown, index: number) => (
        <div key={(item as { id?: string }).id ?? index}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}));

vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid='markdown'>{children}</div>,
}));

vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@icon-park/react', () => ({
  ArrowUp: () => <span data-testid='icon-arrow-up' />,
}));

// ── Import SUT after mocks ──────────────────────────────────────────────────

import GroupRoomPage from '../../../src/renderer/pages/group-room/GroupRoomPage';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRoomData(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      id: mockRoomId,
      name: 'Test Room',
      status: 'idle',
      members: [
        { id: 'host-1', displayName: 'Host', agentType: 'claude', role: 'host', status: 'idle', currentTask: null },
        { id: 'sub-1', displayName: 'Coder', agentType: 'claude', role: 'sub', status: 'idle', currentTask: null },
      ],
      messages: [],
      ...overrides,
    },
  };
}

/** Find the Arco tab header element by text. Sub names appear in both tab header and MemberPanel,
 *  so we scope the search to `.arco-tabs-header` to avoid ambiguity. */
function getTabByName(container: HTMLElement, name: string): HTMLElement {
  const tabHeader = container.querySelector('.arco-tabs-header-nav')!;
  const allTabs = tabHeader.querySelectorAll('.arco-tabs-header-title');
  const found = Array.from(allTabs).find((el) => el.textContent?.includes(name));
  if (!found) throw new Error(`Tab "${name}" not found`);
  return found as HTMLElement;
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;

  mockStreamOn.mockImplementation((handler) => {
    streamHandler = handler;
    return () => {};
  });
  mockMemberOn.mockImplementation((handler) => {
    memberHandler = handler;
    return () => {};
  });
  mockTurnOn.mockImplementation((handler) => {
    turnHandler = handler;
    return () => {};
  });

  mockSendMessage.mockResolvedValue(undefined);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GroupRoomPage', () => {
  // Case 11: room name in header after loading
  describe('Case 11: room name renders in header', () => {
    it('displays the room name from IPC response', async () => {
      mockGet.mockResolvedValue(makeRoomData({ name: 'My Group' }));
      render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('My Group')).toBeInTheDocument();
      });
    });
  });

  // Case 12: member list
  describe('Case 12: member list', () => {
    it('shows member names in MemberPanel', async () => {
      mockGet.mockResolvedValue(makeRoomData());
      const { container } = render(<GroupRoomPage />);

      // MemberPanel is the 220px-wide div
      await waitFor(() => {
        const panel = container.querySelector('[style*="width: 220px"]')!;
        expect(within(panel as HTMLElement).getByText('Host')).toBeInTheDocument();
        expect(within(panel as HTMLElement).getByText('Coder')).toBeInTheDocument();
      });
    });

    it('shows member count', async () => {
      mockGet.mockResolvedValue(makeRoomData());
      render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('(2)')).toBeInTheDocument();
      });
    });
  });

  // Case 13: group room UI distinguishers
  describe('Case 13: group room specific UI elements', () => {
    it('has Arco Tabs', async () => {
      mockGet.mockResolvedValue(makeRoomData());
      const { container } = render(<GroupRoomPage />);

      await waitFor(() => {
        expect(container.querySelector('.arco-tabs')).toBeInTheDocument();
      });
    });

    it('has main conversation tab title', async () => {
      mockGet.mockResolvedValue(makeRoomData());
      render(<GroupRoomPage />);

      // The t() mock returns defaultValue '\u4E3B\u5BF9\u8BDD'
      await waitFor(() => {
        expect(screen.getByText('\u4E3B\u5BF9\u8BDD')).toBeInTheDocument();
      });
    });

    it('has MemberPanel with 220px width', async () => {
      mockGet.mockResolvedValue(makeRoomData());
      const { container } = render(<GroupRoomPage />);

      await waitFor(() => {
        const panel = container.querySelector('[style*="width: 220px"]');
        expect(panel).toBeInTheDocument();
      });
    });

    it('shows empty message placeholder when no messages', async () => {
      mockGet.mockResolvedValue(makeRoomData({ messages: [] }));
      render(<GroupRoomPage />);

      // '\u6682\u65E0\u6D88\u606F' = '暂无消息'
      await waitFor(() => {
        expect(screen.getByText('\u6682\u65E0\u6D88\u606F')).toBeInTheDocument();
      });
    });

    it('shows historical messages in list', async () => {
      mockGet.mockResolvedValue(
        makeRoomData({
          messages: [
            {
              id: 'm1',
              msgKind: 'user_input',
              senderType: 'user',
              senderId: null,
              content: 'Hello world',
              status: 'finish',
              createdAt: Date.now(),
            },
            {
              id: 'm2',
              msgKind: 'host_response',
              senderType: 'agent',
              senderId: 'host-1',
              content: 'Hi there',
              status: 'finish',
              createdAt: Date.now(),
            },
          ],
        })
      );
      render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('Hello world')).toBeInTheDocument();
        expect(screen.getByText('Hi there')).toBeInTheDocument();
      });
    });
  });

  // Case 14: main panel shows host_thought and result_injection, not sub_output
  describe('Case 14: main panel message filtering', () => {
    it('includes host_thought in main panel virtuoso list', async () => {
      mockGet.mockResolvedValue(
        makeRoomData({
          messages: [
            {
              id: 'm1',
              msgKind: 'host_thought',
              senderType: 'agent',
              senderId: 'host-1',
              content: 'Thinking hard...',
              status: 'finish',
              createdAt: Date.now(),
            },
            {
              id: 'm2',
              msgKind: 'user_input',
              senderType: 'user',
              senderId: null,
              content: 'Visible input',
              status: 'finish',
              createdAt: Date.now(),
            },
          ],
        })
      );
      render(<GroupRoomPage />);

      // Both host_thought and user_input are in MAIN_PANEL_KINDS, so the Virtuoso list has 2 items.
      // host_thought falls to default in GroupMessageItem (returns null), but the wrapper div is rendered.
      await waitFor(() => {
        const list = screen.getByTestId('virtuoso-list');
        expect(list.children.length).toBe(2);
      });

      // user_input is visible as expected
      expect(screen.getByText('Visible input')).toBeInTheDocument();
    });

    it('shows result_injection in main panel virtuoso list', async () => {
      mockGet.mockResolvedValue(
        makeRoomData({
          messages: [
            {
              id: 'm2',
              msgKind: 'result_injection',
              senderType: 'agent',
              senderId: 'sub-1',
              senderName: 'Coder',
              targetId: 'host-1',
              targetName: 'Host',
              content: 'Result data',
              status: 'finish',
              createdAt: Date.now(),
            },
          ],
        })
      );
      render(<GroupRoomPage />);

      // result_injection is in MAIN_PANEL_KINDS so it appears in the Virtuoso list
      // GroupMessageItem default case returns null, but the Virtuoso wrapper div is still rendered
      await waitFor(() => {
        const list = screen.getByTestId('virtuoso-list');
        expect(list).toBeInTheDocument();
        // The list should have 1 child (even though content renders null inside)
        expect(list.children.length).toBe(1);
      });
    });

    it('does not show sub_output in main panel', async () => {
      mockGet.mockResolvedValue(
        makeRoomData({
          messages: [
            {
              id: 'm1',
              msgKind: 'user_input',
              senderType: 'user',
              senderId: null,
              content: 'Go',
              status: 'finish',
              createdAt: Date.now(),
            },
            {
              id: 'm-sub',
              msgKind: 'sub_output',
              senderType: 'agent',
              senderId: 'sub-1',
              senderName: 'Coder',
              targetId: 'host-1',
              targetName: 'Host',
              content: 'Sub result hidden from main',
              status: 'finish',
              createdAt: Date.now(),
            },
          ],
        })
      );
      render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('Go')).toBeInTheDocument();
      });

      // sub_output is NOT in MAIN_PANEL_KINDS so it won't appear in the main tab
      expect(screen.queryByText('Sub result hidden from main')).not.toBeInTheDocument();
    });
  });

  // Case 15: dynamic sub-agent tabs
  describe('Case 15: dynamic sub-agent tabs', () => {
    it('renders tabs for each sub-agent', async () => {
      mockGet.mockResolvedValue(
        makeRoomData({
          members: [
            { id: 'host-1', displayName: 'Host', agentType: 'claude', role: 'host', status: 'idle', currentTask: null },
            { id: 'sub-1', displayName: 'Coder', agentType: 'claude', role: 'sub', status: 'idle', currentTask: null },
            { id: 'sub-2', displayName: 'Tester', agentType: 'claude', role: 'sub', status: 'idle', currentTask: null },
          ],
        })
      );
      const { container } = render(<GroupRoomPage />);

      await waitFor(() => {
        // 3 tab headers: main + 2 sub (Arco uses .arco-tabs-header-title for each tab)
        const tabTitles = container.querySelectorAll('.arco-tabs-header-title');
        expect(tabTitles.length).toBe(3);
      });

      // Sub tab titles show displayName (scoped to tab header to avoid MemberPanel duplication)
      const tabNav = container.querySelector('.arco-tabs-header-nav')!;
      expect(within(tabNav as HTMLElement).getByText('Coder')).toBeInTheDocument();
      expect(within(tabNav as HTMLElement).getByText('Tester')).toBeInTheDocument();
    });

    it('adds a new tab when memberChanged:join fires', async () => {
      mockGet.mockResolvedValue(makeRoomData());
      const { container } = render(<GroupRoomPage />);

      await waitFor(() => {
        // main + sub-1 = 2 tab headers
        const tabs = container.querySelectorAll('.arco-tabs-header-title');
        expect(tabs.length).toBe(2);
      });

      // Simulate new member joining
      act(() => {
        memberHandler({
          roomId: mockRoomId,
          action: 'join',
          member: {
            id: 'sub-new',
            displayName: 'NewCoder',
            agentType: 'claude',
            role: 'sub',
            status: 'idle',
            currentTask: null,
          },
        });
      });

      await waitFor(() => {
        const tabs = container.querySelectorAll('.arco-tabs-header-title');
        expect(tabs.length).toBe(3);
      });

      // NewCoder should appear somewhere on the page (tab + possibly MemberPanel)
      expect(screen.getAllByText('NewCoder').length).toBeGreaterThanOrEqual(1);
    });
  });

  // Case 16: clicking sub tab switches content
  describe('Case 16: sub tab content switching', () => {
    it('shows sub messages when clicking sub tab', async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(
        makeRoomData({
          members: [
            { id: 'host-1', displayName: 'Host', agentType: 'claude', role: 'host', status: 'idle', currentTask: null },
            { id: 'sub-1', displayName: 'Coder', agentType: 'claude', role: 'sub', status: 'idle', currentTask: null },
          ],
          messages: [
            {
              id: 'm1',
              msgKind: 'user_input',
              senderType: 'user',
              senderId: null,
              content: 'User msg',
              status: 'finish',
              createdAt: Date.now(),
            },
            {
              id: 'm2',
              msgKind: 'sub_output',
              senderType: 'agent',
              senderId: 'sub-1',
              senderName: 'Coder',
              targetId: 'host-1',
              targetName: 'Host',
              content: 'Sub-1 output',
              status: 'finish',
              createdAt: Date.now(),
            },
          ],
        })
      );
      const { container } = render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('User msg')).toBeInTheDocument();
      });

      // Click the Coder sub tab (scoped to tab header)
      const coderTab = getTabByName(container, 'Coder');
      await user.click(coderTab);

      // Sub output should now be visible in the sub tab's Virtuoso list
      await waitFor(() => {
        expect(screen.getByText('Sub-1 output')).toBeInTheDocument();
      });
    });
  });

  // Case 17: user input triggers full flow
  describe('Case 17: user input flow', () => {
    it('sends message, shows optimistic message, clears input', async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(makeRoomData());
      render(<GroupRoomPage />);

      await waitFor(() => {
        // Wait for data to load
        expect(screen.getByText('(2)')).toBeInTheDocument();
      });

      // Find textarea via placeholder '\u53D1\u9001\u6D88\u606F\u2026' = '发送消息...'
      const textarea = screen.getByPlaceholderText('\u53D1\u9001\u6D88\u606F\u2026');
      expect(textarea).toBeInTheDocument();

      // Type a message
      await user.type(textarea, 'Hello team');

      // Press Enter
      await user.keyboard('{Enter}');

      // Optimistic message should appear
      await waitFor(() => {
        expect(screen.getByText('Hello team')).toBeInTheDocument();
      });

      // sendMessage should have been called
      expect(mockSendMessage).toHaveBeenCalledWith({
        roomId: mockRoomId,
        input: 'Hello team',
        msg_id: 'mock-uuid-1',
      });

      // Textarea should be cleared
      expect(textarea).toHaveValue('');
    });
  });

  // Case 18: sub tab is read-only (no send box)
  describe('Case 18: sub agent tab is read-only', () => {
    it('has no send-box textarea in active sub tab pane', async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(
        makeRoomData({
          members: [
            { id: 'host-1', displayName: 'Host', agentType: 'claude', role: 'host', status: 'idle', currentTask: null },
            { id: 'sub-1', displayName: 'Coder', agentType: 'claude', role: 'sub', status: 'idle', currentTask: null },
          ],
          messages: [
            {
              id: 'm1',
              msgKind: 'sub_output',
              senderType: 'agent',
              senderId: 'sub-1',
              senderName: 'Coder',
              targetId: 'host-1',
              targetName: 'Host',
              content: 'output stuff',
              status: 'finish',
              createdAt: Date.now(),
            },
          ],
        })
      );
      const { container } = render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('(2)')).toBeInTheDocument();
      });

      // Click sub tab
      const coderTab = getTabByName(container, 'Coder');
      await user.click(coderTab);

      // Wait for sub tab content to appear
      await waitFor(() => {
        expect(screen.getByText('output stuff')).toBeInTheDocument();
      });

      // Content is managed outside Arco Tabs. When sub tab is active,
      // AgentTabContent renders instead of GroupRoomSendBox — no textarea.
      const textareas = container.querySelectorAll('textarea');
      expect(textareas.length).toBe(0);
    });
  });

  // Case 19: real-time status display
  describe('Case 19: real-time status', () => {
    it('shows running indicator dot when room status is running', async () => {
      mockGet.mockResolvedValue(makeRoomData({ status: 'running' }));
      render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('Test Room')).toBeInTheDocument();
      });

      // RoomStatusDot uses inline style with success color for running status
      const dot = document.querySelector('span[style*="rgb(var(--success-6))"]');
      expect(dot).toBeInTheDocument();
    });

    it('shows running text when isRunning is true', async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(makeRoomData());
      render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('(2)')).toBeInTheDocument();
      });

      // Initially idle, no running text '\u8FD0\u884C\u4E2D\u2026' = '运行中...'
      expect(screen.queryByText('\u8FD0\u884C\u4E2D\u2026')).not.toBeInTheDocument();

      // Simulate sending a message to trigger isRunning=true
      const textarea = screen.getByPlaceholderText('\u53D1\u9001\u6D88\u606F\u2026');
      await user.type(textarea, 'test{Enter}');

      await waitFor(() => {
        expect(screen.getByText('\u8FD0\u884C\u4E2D\u2026')).toBeInTheDocument();
      });
    });

    it('turnCompleted event clears running state', async () => {
      const user = userEvent.setup();
      mockGet.mockResolvedValue(makeRoomData());
      render(<GroupRoomPage />);

      await waitFor(() => {
        expect(screen.getByText('(2)')).toBeInTheDocument();
      });

      // Send a message to set isRunning=true
      const textarea = screen.getByPlaceholderText('\u53D1\u9001\u6D88\u606F\u2026');
      await user.type(textarea, 'go{Enter}');

      await waitFor(() => {
        expect(screen.getByText('\u8FD0\u884C\u4E2D\u2026')).toBeInTheDocument();
      });

      // Fire turnCompleted with canSendMessage=true -> setRunning(false)
      act(() => {
        turnHandler({ roomId: mockRoomId, canSendMessage: true });
      });

      await waitFor(() => {
        expect(screen.queryByText('\u8FD0\u884C\u4E2D\u2026')).not.toBeInTheDocument();
      });

      // Textarea should be re-enabled
      const input = screen.getByPlaceholderText('\u53D1\u9001\u6D88\u606F\u2026');
      expect(input).not.toBeDisabled();
    });

    it('member status change updates MemberPanel badge', async () => {
      mockGet.mockResolvedValue(makeRoomData());
      const { container } = render(<GroupRoomPage />);

      await waitFor(() => {
        const panel = container.querySelector('[style*="width: 220px"]')!;
        expect(within(panel as HTMLElement).getByText('Coder')).toBeInTheDocument();
      });

      // Initially idle -> badge status = 'default'
      const badges = container.querySelectorAll('.arco-badge-status-default');
      expect(badges.length).toBeGreaterThanOrEqual(1);

      // Simulate member status update to 'running'
      act(() => {
        memberHandler({
          roomId: mockRoomId,
          action: 'status_update',
          member: { id: 'sub-1', status: 'running', currentTask: 'Building module' },
        });
      });

      await waitFor(() => {
        const processingBadges = container.querySelectorAll('.arco-badge-status-processing');
        expect(processingBadges.length).toBeGreaterThanOrEqual(1);
      });

      // currentTask should now show
      expect(screen.getByText('Building module')).toBeInTheDocument();
    });
  });
});
