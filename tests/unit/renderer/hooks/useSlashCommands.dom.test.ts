import type { SlashCommandItem } from '@/common/chat/slash/types';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSlashCommandsInvoke = vi.fn();
const mockIsSlashCommandListEnabled = vi.fn(() => true);

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getSlashCommands: {
        invoke: (...args: unknown[]) => mockGetSlashCommandsInvoke(...args),
      },
    },
  },
}));

vi.mock('@/common/chat/slash/availability', () => ({
  isSlashCommandListEnabled: (...args: unknown[]) => mockIsSlashCommandListEnabled(...args),
}));

import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';

const createCommand = (name: string): SlashCommandItem => ({
  name,
  description: `${name} description`,
  kind: 'template',
  source: 'acp',
});

describe('useSlashCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSlashCommandListEnabled.mockReturnValue(true);
  });

  it('re-fetches ACP slash commands when agentRevision changes without a visible status change', async () => {
    mockGetSlashCommandsInvoke
      .mockResolvedValueOnce({
        success: true,
        data: {
          commands: [createCommand('alpha')],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          commands: [createCommand('beta')],
        },
      });

    const { result, rerender } = renderHook(
      ({ conversationId, agentRevision }) =>
        useSlashCommands(conversationId, {
          agentStatus: 'session_active',
          agentRevision,
        }),
      {
        initialProps: {
          conversationId: 'slash-revision-conv',
          agentRevision: 0,
        },
      }
    );

    await waitFor(() => {
      expect(result.current).toEqual([createCommand('alpha')]);
    });

    expect(mockGetSlashCommandsInvoke).toHaveBeenCalledTimes(1);

    rerender({
      conversationId: 'slash-revision-conv',
      agentRevision: 1,
    });

    await waitFor(() => {
      expect(result.current).toEqual([createCommand('beta')]);
    });

    expect(mockGetSlashCommandsInvoke).toHaveBeenCalledTimes(2);
  });

  it('does not re-fetch ACP slash commands when agentRevision and status stay unchanged', async () => {
    mockGetSlashCommandsInvoke.mockResolvedValueOnce({
      success: true,
      data: {
        commands: [createCommand('stable')],
      },
    });

    const { result, rerender } = renderHook(
      ({ conversationId, agentRevision }) =>
        useSlashCommands(conversationId, {
          agentStatus: 'session_active',
          agentRevision,
        }),
      {
        initialProps: {
          conversationId: 'slash-stable-conv',
          agentRevision: 0,
        },
      }
    );

    await waitFor(() => {
      expect(result.current).toEqual([createCommand('stable')]);
    });

    rerender({
      conversationId: 'slash-stable-conv',
      agentRevision: 0,
    });

    expect(mockGetSlashCommandsInvoke).toHaveBeenCalledTimes(1);
  });
});
