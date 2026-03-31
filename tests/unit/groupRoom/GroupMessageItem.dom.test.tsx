/**
 * DOM unit tests for GroupMessageItem, GroupMessageDispatch, GroupThinkingBlock.
 *
 * Uses jsdom environment (via .dom.test.tsx suffix).
 * Setup file already provides @testing-library/jest-dom, ResizeObserver mock, electronAPI mock.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GroupMember, GroupMessage } from '@renderer/pages/group-room/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// matchMedia (Arco needs it)
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

// i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) || key,
    i18n: { language: 'en-US' },
  }),
}));

// MarkdownView
vi.mock('@renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid='markdown'>{children}</div>,
}));

// CollapsibleContent
vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='collapsible'>{children}</div>,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import GroupMessageItem from '@renderer/pages/group-room/components/GroupMessageItem';
import GroupMessageDispatch from '@renderer/pages/group-room/components/GroupMessageDispatch';
import GroupThinkingBlock from '@renderer/pages/group-room/components/GroupThinkingBlock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEMBERS: GroupMember[] = [
  {
    id: 'agent-host',
    displayName: 'Host Agent',
    agentType: 'coordinator',
    role: 'host',
    status: 'idle',
    currentTask: null,
  },
  {
    id: 'agent-sub-1',
    displayName: 'Worker Alpha',
    agentType: 'coder',
    role: 'sub',
    status: 'idle',
    currentTask: null,
  },
];

function makeMsg(partial: Partial<GroupMessage>): GroupMessage {
  return {
    id: 'msg-1',
    msgKind: 'user_input',
    senderId: null,
    senderName: null,
    targetId: null,
    targetName: null,
    senderRole: null,
    content: '',
    streaming: false,
    createdAt: Date.now(),
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Case 13: Group detail distinguishes from normal conversation
// ---------------------------------------------------------------------------

describe('GroupMessageItem - msgKind routing (Case 13)', () => {
  it('user_input renders right-aligned bubble with MarkdownView', () => {
    const msg = makeMsg({ msgKind: 'user_input', content: 'Hello world' });
    const { container } = render(<GroupMessageItem message={msg} members={MEMBERS} />);
    // Right-aligned wrapper
    const wrapper = container.querySelector('.flex.justify-end');
    expect(wrapper).toBeInTheDocument();
    // Content inside markdown
    expect(screen.getByTestId('markdown')).toHaveTextContent('Hello world');
  });

  it('host_response renders left-aligned with senderName Tag', () => {
    const msg = makeMsg({
      msgKind: 'host_response',
      senderId: 'agent-host',
      content: 'I will handle this',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    // Tag with displayName
    expect(screen.getByText('Host Agent')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('I will handle this');
  });

  it('host_dispatch renders GroupMessageDispatch', () => {
    const msg = makeMsg({
      msgKind: 'host_dispatch',
      senderId: 'agent-host',
      targetId: 'agent-sub-1',
      targetName: 'Worker Alpha',
      content: 'Please implement feature X',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText(/Host Agent/)).toBeInTheDocument();
    expect(screen.getByText(/Worker Alpha/)).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('Please implement feature X');
  });

  it('system renders GroupSystemMessage', () => {
    const msg = makeMsg({
      msgKind: 'system',
      content: 'Room created',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText('Room created')).toBeInTheDocument();
  });

  it('sub_status renders GroupSystemMessage', () => {
    const msg = makeMsg({
      msgKind: 'sub_status',
      content: 'Worker Alpha started task',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText('Worker Alpha started task')).toBeInTheDocument();
  });

  it('agent_join renders GroupSystemMessage', () => {
    const msg = makeMsg({
      msgKind: 'agent_join',
      content: 'Worker Alpha joined the room',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText('Worker Alpha joined the room')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Case 5: Thinking process display
// ---------------------------------------------------------------------------

describe('GroupMessageItem - thinking (Case 5)', () => {
  it('host_thought renders GroupThinkingBlock for host reasoning', () => {
    const msg = makeMsg({
      msgKind: 'host_thought',
      senderId: 'agent-host',
      content: 'Let me think...',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText(/Host Agent/)).toBeInTheDocument();
    expect(screen.getByText('Let me think...')).toBeInTheDocument();
  });

  it('sub_thinking renders GroupThinkingBlock with agentName', () => {
    const msg = makeMsg({
      msgKind: 'sub_thinking',
      senderId: 'agent-sub-1',
      content: 'Analyzing code...',
      streaming: true,
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    // agentName resolved from members
    expect(screen.getByText(/Worker Alpha/)).toBeInTheDocument();
    // Content rendered inside collapsible
    expect(screen.getByTestId('collapsible')).toBeInTheDocument();
    expect(screen.getByText('Analyzing code...')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Case 14: Main panel display
// ---------------------------------------------------------------------------

describe('GroupMessageItem - main panel report cases (Case 14)', () => {
  it('result_injection renders reinjected report content', () => {
    const msg = makeMsg({
      msgKind: 'result_injection',
      senderId: 'agent-sub-1',
      content: 'injection payload',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText(/Worker Alpha/)).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('injection payload');
  });
});

// ---------------------------------------------------------------------------
// Case 16: Sub-agent tab messages
// ---------------------------------------------------------------------------

describe('GroupMessageItem - sub-agent tab (Case 16)', () => {
  it('sub_output renders GroupMessageReport with correct content', () => {
    const msg = makeMsg({
      msgKind: 'sub_output',
      senderId: 'agent-sub-1',
      targetId: 'agent-host',
      targetName: 'Host Agent',
      content: 'Task completed successfully',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText(/Worker Alpha/)).toBeInTheDocument();
    expect(screen.getByText(/Host Agent/)).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('Task completed successfully');
  });

  it('sub_thinking renders GroupThinkingBlock', () => {
    const msg = makeMsg({
      msgKind: 'sub_thinking',
      senderId: 'agent-sub-1',
      content: '',
      streaming: false,
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText(/Worker Alpha/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Member name resolution
// ---------------------------------------------------------------------------

describe('GroupMessageItem - member name resolution', () => {
  it('resolves displayName from members list', () => {
    const msg = makeMsg({
      msgKind: 'host_response',
      senderId: 'agent-host',
      content: 'resolved',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText('Host Agent')).toBeInTheDocument();
  });

  it('falls back to senderId when member not found', () => {
    const msg = makeMsg({
      msgKind: 'host_response',
      senderId: 'unknown-agent-99',
      content: 'fallback',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText('unknown-agent-99')).toBeInTheDocument();
  });

  it('uses senderName from message when provided (overrides member lookup)', () => {
    const msg = makeMsg({
      msgKind: 'host_response',
      senderId: 'agent-host',
      senderName: 'Custom Name',
      content: 'override',
    });
    render(<GroupMessageItem message={msg} members={MEMBERS} />);
    expect(screen.getByText('Custom Name')).toBeInTheDocument();
  });

  it('senderId=null results in empty senderName', () => {
    const msg = makeMsg({
      msgKind: 'host_response',
      senderId: null,
      content: 'no sender',
    });
    const { container } = render(<GroupMessageItem message={msg} members={MEMBERS} />);
    // No Tag rendered because senderName is ''
    const tag = container.querySelector('.arco-tag');
    expect(tag).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// GroupMessageDispatch (direct)
// ---------------------------------------------------------------------------

describe('GroupMessageDispatch', () => {
  it('renders arrow notation and content', () => {
    render(<GroupMessageDispatch senderName='Host Agent' targetName='Worker Alpha' content='Do this task' />);
    const arrowText = screen.getByText(/Host Agent/);
    expect(arrowText).toHaveTextContent('\u2192 Host Agent \u2192 Worker Alpha');
    expect(screen.getByTestId('markdown')).toHaveTextContent('Do this task');
  });

  it('has blue left border styling', () => {
    const { container } = render(<GroupMessageDispatch senderName='A' targetName='B' content='c' />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.style.borderLeft).toContain('3px solid');
  });
});

// ---------------------------------------------------------------------------
// GroupThinkingBlock (direct)
// ---------------------------------------------------------------------------

describe('GroupThinkingBlock', () => {
  it('running=true shows spinner and thinking label', () => {
    const { container } = render(<GroupThinkingBlock agentName='Worker Alpha' content='' running={true} />);
    // Arco Spin renders an element with arco-spin class
    const spin = container.querySelector('.arco-spin');
    expect(spin).toBeInTheDocument();
    // i18n key for thinking
    expect(screen.getByText(/Worker Alpha.*conversation\.groupRoom\.msg\.thinking/)).toBeInTheDocument();
  });

  it('running=false shows done label with seconds', () => {
    render(<GroupThinkingBlock agentName='Worker Alpha' content='done' running={false} elapsedSeconds={5} />);
    expect(screen.getByText(/Worker Alpha.*conversation\.groupRoom\.msg\.thinkingDone/)).toBeInTheDocument();
  });

  it('empty content does not render CollapsibleContent', () => {
    render(<GroupThinkingBlock agentName='Worker Alpha' content='' running={true} />);
    expect(screen.queryByTestId('collapsible')).not.toBeInTheDocument();
  });

  it('non-empty content renders CollapsibleContent', () => {
    render(<GroupThinkingBlock agentName='Worker Alpha' content='Thinking about stuff...' running={true} />);
    expect(screen.getByTestId('collapsible')).toBeInTheDocument();
    expect(screen.getByText('Thinking about stuff...')).toBeInTheDocument();
  });
});
