import type { TChatConversation } from '@/common/config/storage';
import ChatConversation from '@/renderer/pages/conversation/components/ChatConversation';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUsePresetAssistantInfo = vi.fn<
  (conversation?: TChatConversation) => {
    info: { name: string; logo?: string; isEmoji?: boolean } | null;
    isLoading: boolean;
  }
>();

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: (conversation?: TChatConversation) => mockUsePresetAssistantInfo(conversation),
}));

vi.mock('@/renderer/pages/conversation/components/ChatLayout', () => ({
  __esModule: true,
  default: ({
    backend,
    agentName,
    showAcpRuntimeDiagnostics,
    children,
  }: {
    backend?: string;
    agentName?: string;
    showAcpRuntimeDiagnostics?: boolean;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': 'chat-layout',
        'data-backend': backend ?? '',
        'data-agent-name': agentName ?? '',
        'data-show-acp-runtime-diagnostics': String(Boolean(showAcpRuntimeDiagnostics)),
      },
      children
    ),
}));

vi.mock('@/renderer/pages/conversation/components/ChatSider', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/acp/AcpChat', () => ({
  __esModule: true,
  default: ({ backend }: { backend: string }) =>
    React.createElement('div', { 'data-testid': 'acp-chat', 'data-backend': backend }),
}));

vi.mock('@/renderer/pages/conversation/platforms/nanobot/NanobotChat', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/openclaw/OpenClawChat', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/remote/RemoteChat', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/components/agent/AcpModelSelector', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/GeminiModelSelector', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/gemini/useGeminiModelSelection', () => ({
  useGeminiModelSelection: () => ({}),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsChat', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/AionrsModelSelector', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection', () => ({
  useAionrsModelSelection: () => ({}),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    openPreview: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobManager: () => React.createElement('div'),
}));

vi.mock('@/renderer/pages/conversation/platforms/openclaw/StarOfficeMonitorCard.tsx', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

vi.mock('@/common', () => ({
  ipcBridge: {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: null }),
}));

const createConversation = (overrides: Partial<TChatConversation> = {}): TChatConversation =>
  ({
    id: 'conv-acp',
    type: 'acp',
    name: 'ACP Conversation',
    createTime: Date.now(),
    modifyTime: Date.now(),
    extra: {},
    ...overrides,
  }) as TChatConversation;

describe('ChatConversation ACP runtime diagnostics backend identity', () => {
  beforeEach(() => {
    mockUsePresetAssistantInfo.mockReset();
  });

  it('keeps Claude backend identity while preset assistant info is still loading', () => {
    mockUsePresetAssistantInfo.mockReturnValue({
      info: null,
      isLoading: true,
    });

    render(<ChatConversation conversation={createConversation()} />);

    expect(screen.getByTestId('chat-layout')).toHaveAttribute('data-backend', 'claude');
    expect(screen.getByTestId('chat-layout')).toHaveAttribute('data-show-acp-runtime-diagnostics', 'true');
    expect(screen.getByTestId('acp-chat')).toHaveAttribute('data-backend', 'claude');
  });

  it('keeps Claude backend identity when preset assistant metadata is available', () => {
    mockUsePresetAssistantInfo.mockReturnValue({
      info: { name: 'Preset ACP Agent', logo: 'P', isEmoji: true },
      isLoading: false,
    });

    render(<ChatConversation conversation={createConversation()} />);

    expect(screen.getByTestId('chat-layout')).toHaveAttribute('data-backend', 'claude');
    expect(screen.getByTestId('chat-layout')).toHaveAttribute('data-agent-name', 'Preset ACP Agent');
    expect(screen.getByTestId('chat-layout')).toHaveAttribute('data-show-acp-runtime-diagnostics', 'true');
  });
});
