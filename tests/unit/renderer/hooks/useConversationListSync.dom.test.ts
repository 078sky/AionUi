import { act, renderHook, waitFor } from '@testing-library/react';
import type { TChatConversation } from '@/common/config/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ResponseStreamMessage = {
  type: string;
  conversation_id?: string;
  data?: unknown;
};

type TurnCompletedEvent = {
  sessionId: string;
  state: string;
};

type ConversationListChangedEvent = {
  conversationId: string;
  action: 'created' | 'updated' | 'deleted';
  source?: string;
};

const {
  addEventListenerMock,
  listChangedListeners,
  mockGetUserConversationsInvoke,
  responseStreamListeners,
  turnCompletedListeners,
} = vi.hoisted(() => ({
  addEventListenerMock: vi.fn(),
  listChangedListeners: new Set<(event: ConversationListChangedEvent) => void>(),
  mockGetUserConversationsInvoke: vi.fn(),
  responseStreamListeners: new Set<(message: ResponseStreamMessage) => void>(),
  turnCompletedListeners: new Set<(event: TurnCompletedEvent) => void>(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      listChanged: {
        on: vi.fn((listener: (event: ConversationListChangedEvent) => void) => {
          listChangedListeners.add(listener);
          return () => {
            listChangedListeners.delete(listener);
          };
        }),
      },
      responseStream: {
        on: vi.fn((listener: (message: ResponseStreamMessage) => void) => {
          responseStreamListeners.add(listener);
          return () => {
            responseStreamListeners.delete(listener);
          };
        }),
      },
      turnCompleted: {
        on: vi.fn((listener: (event: TurnCompletedEvent) => void) => {
          turnCompletedListeners.add(listener);
          return () => {
            turnCompletedListeners.delete(listener);
          };
        }),
      },
    },
    database: {
      getUserConversations: {
        invoke: (...args: unknown[]) => mockGetUserConversationsInvoke(...args),
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  addEventListener: (...args: unknown[]) => addEventListenerMock(...args),
}));

const createConversation = (id: string): TChatConversation => ({
  id,
  name: `Conversation ${id}`,
  createTime: Date.now(),
  modifyTime: Date.now(),
  type: 'acp',
  source: 'aionui',
  extra: {
    backend: 'claude',
  },
  model: {
    id: 'claude-1',
    name: 'Claude',
    useModel: 'claude-sonnet',
    platform: 'claude',
    baseUrl: '',
    apiKey: '',
  },
});

const emitResponseStream = (message: ResponseStreamMessage): void => {
  act(() => {
    for (const listener of responseStreamListeners) {
      listener(message);
    }
  });
};

const loadConversationListSyncHook = async () => {
  vi.resetModules();
  return await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
};

describe('useConversationListSync', () => {
  beforeEach(() => {
    addEventListenerMock.mockReset();
    listChangedListeners.clear();
    mockGetUserConversationsInvoke.mockReset();
    responseStreamListeners.clear();
    turnCompletedListeners.clear();
    mockGetUserConversationsInvoke.mockResolvedValue([createConversation('acp-conv-1')]);
  });

  afterEach(() => {
    listChangedListeners.clear();
    responseStreamListeners.clear();
    turnCompletedListeners.clear();
  });

  it('clears the generating marker without marking unread when the active ACP conversation hits auth_required', async () => {
    const { useConversationListSync } = await loadConversationListSyncHook();
    const { result } = renderHook(() => useConversationListSync());

    await waitFor(() => {
      expect(result.current.conversations.map((conversation) => conversation.id)).toEqual(['acp-conv-1']);
    });

    act(() => {
      result.current.setActiveConversation('acp-conv-1');
    });

    emitResponseStream({
      type: 'start',
      conversation_id: 'acp-conv-1',
      data: null,
    });

    await waitFor(() => {
      expect(result.current.isConversationGenerating('acp-conv-1')).toBe(true);
    });

    emitResponseStream({
      type: 'agent_status',
      conversation_id: 'acp-conv-1',
      data: {
        status: 'auth_required',
      },
    });

    await waitFor(() => {
      expect(result.current.isConversationGenerating('acp-conv-1')).toBe(false);
    });

    expect(result.current.hasCompletionUnread('acp-conv-1')).toBe(false);
  });

  it('marks unread after auth_required clears an inactive ACP conversation that was generating', async () => {
    const { useConversationListSync } = await loadConversationListSyncHook();
    const { result } = renderHook(() => useConversationListSync());

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    act(() => {
      result.current.setActiveConversation('another-conversation');
    });

    emitResponseStream({
      type: 'start',
      conversation_id: 'acp-conv-1',
      data: null,
    });

    await waitFor(() => {
      expect(result.current.isConversationGenerating('acp-conv-1')).toBe(true);
    });

    emitResponseStream({
      type: 'agent_status',
      conversation_id: 'acp-conv-1',
      data: {
        status: 'auth_required',
      },
    });

    await waitFor(() => {
      expect(result.current.isConversationGenerating('acp-conv-1')).toBe(false);
    });

    expect(result.current.hasCompletionUnread('acp-conv-1')).toBe(true);
  });

  it('does not create unread or generating state when auth_required arrives without a running ACP turn', async () => {
    const { useConversationListSync } = await loadConversationListSyncHook();
    const { result } = renderHook(() => useConversationListSync());

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    act(() => {
      result.current.setActiveConversation('another-conversation');
    });

    emitResponseStream({
      type: 'agent_status',
      conversation_id: 'acp-conv-1',
      data: {
        status: 'auth_required',
      },
    });

    expect(result.current.isConversationGenerating('acp-conv-1')).toBe(false);
    expect(result.current.hasCompletionUnread('acp-conv-1')).toBe(false);
  });

  it('keeps the generating marker for non-terminal ACP status updates until finish arrives', async () => {
    const { useConversationListSync } = await loadConversationListSyncHook();
    const { result } = renderHook(() => useConversationListSync());

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });

    emitResponseStream({
      type: 'start',
      conversation_id: 'acp-conv-1',
      data: null,
    });

    await waitFor(() => {
      expect(result.current.isConversationGenerating('acp-conv-1')).toBe(true);
    });

    emitResponseStream({
      type: 'agent_status',
      conversation_id: 'acp-conv-1',
      data: {
        status: 'session_active',
      },
    });

    expect(result.current.isConversationGenerating('acp-conv-1')).toBe(true);

    emitResponseStream({
      type: 'finish',
      conversation_id: 'acp-conv-1',
      data: null,
    });

    await waitFor(() => {
      expect(result.current.isConversationGenerating('acp-conv-1')).toBe(false);
    });
  });
});
