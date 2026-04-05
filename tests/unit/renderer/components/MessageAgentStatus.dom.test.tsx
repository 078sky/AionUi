import { render, screen } from '@testing-library/react';
import type { IMessageAgentStatus } from '@/common/chat/chatLib';
import MessageAgentStatus from '@/renderer/pages/conversation/Messages/components/MessageAgentStatus';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const agent = typeof options?.agent === 'string' ? options.agent : 'Agent';
      switch (key) {
        case 'acp.status.auth_required':
          return `${agent} authentication required`;
        case 'acp.status.disconnected':
          return `${agent} disconnected`;
        case 'acp.status.error':
          return 'Connection error';
        default:
          return key;
      }
    },
  }),
}));

function createMessage(status: IMessageAgentStatus['content']['status']): IMessageAgentStatus {
  return {
    id: 'status-message',
    msg_id: 'status-message',
    type: 'agent_status',
    position: 'center',
    conversation_id: 'conv-1',
    createdAt: Date.now(),
    content: {
      backend: 'codex',
      status,
      agentName: 'Codex',
    },
  };
}

describe('MessageAgentStatus', () => {
  it('renders disconnected status instead of hiding it', () => {
    render(<MessageAgentStatus message={createMessage('disconnected')} />);

    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Codex disconnected')).toBeInTheDocument();
  });

  it('renders auth required as a warning state', () => {
    render(<MessageAgentStatus message={createMessage('auth_required')} />);

    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Codex authentication required')).toBeInTheDocument();
  });
});
