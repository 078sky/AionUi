import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import AcpLogsPanel from '@/renderer/pages/conversation/platforms/acp/AcpLogsPanel';
import type { AcpLogEntry } from '@/renderer/pages/conversation/platforms/acp/useAcpMessage';

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, ...props }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { ...props, onClick }, children),
  Space: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('div', props, children),
  Tag: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('span', props, children),
  Typography: {
    Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', {}, children),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      switch (key) {
        case 'acp.logs.title':
          return 'ACP Logs';
        case 'acp.logs.requestStarted':
          return `${options?.backend} -> ${options?.model} started`;
        case 'acp.logs.requestFinished':
          return `${options?.backend} -> ${options?.model} finished in ${options?.duration}ms`;
        case 'acp.logs.requestErrored':
          return `${options?.backend} -> ${options?.model} failed in ${options?.duration}ms`;
        case 'acp.logs.authRequested':
          return `Authenticate requested for ${options?.agent}`;
        case 'acp.logs.authReady':
          return `Authentication ready for ${options?.agent}`;
        case 'acp.logs.authFailed':
          return `Authentication failed for ${options?.agent}`;
        case 'acp.logs.disconnectReason':
          return `code: ${options?.code}, signal: ${options?.signal}`;
        case 'common.show':
          return 'Show';
        case 'common.hide':
          return 'Hide';
        case 'acp.status.auth_required':
          return `${options?.agent} authentication required`;
        case 'acp.status.disconnected':
          return `${options?.agent} disconnected`;
        case 'acp.status.error':
          return 'Connection error';
        default:
          return key;
      }
    },
  }),
}));

const createEntry = (overrides: Partial<AcpLogEntry>): AcpLogEntry => ({
  id: `entry-${Math.random().toString(36).slice(2)}`,
  kind: 'request_started',
  level: 'info',
  timestamp: Date.now(),
  source: 'live',
  backend: 'codex',
  ...overrides,
});

describe('AcpLogsPanel', () => {
  it('renders the latest summary and toggles the log list', () => {
    const entries: AcpLogEntry[] = [
      createEntry({
        kind: 'request_finished',
        level: 'success',
        backend: 'Codex',
        modelId: 'gpt-5',
        durationMs: 1200,
      }),
      createEntry({
        kind: 'request_started',
        backend: 'Codex',
        modelId: 'gpt-5',
      }),
    ];

    render(<AcpLogsPanel entries={entries} />);

    expect(screen.getByTestId('acp-logs-panel')).toBeInTheDocument();
    expect(screen.getByText('Codex -> gpt-5 finished in 1200ms')).toBeInTheDocument();
    expect(screen.queryByTestId('acp-logs-list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(screen.getByTestId('acp-logs-list')).toBeInTheDocument();
    expect(screen.getByText('Codex -> gpt-5 started')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('renders disconnected diagnostics when a disconnected status entry is present', () => {
    const entries: AcpLogEntry[] = [
      createEntry({
        kind: 'status',
        level: 'error',
        backend: 'codex',
        agentName: 'Codex',
        status: 'disconnected',
        disconnectCode: 42,
        disconnectSignal: 'SIGTERM',
      }),
    ];

    render(<AcpLogsPanel entries={entries} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    const logsList = screen.getByTestId('acp-logs-list');
    expect(within(logsList).getByText('Codex disconnected')).toBeInTheDocument();
    expect(within(logsList).getByText('code: 42, signal: SIGTERM')).toBeInTheDocument();
  });

  it('renders auth recovery log entries', () => {
    const entries: AcpLogEntry[] = [
      createEntry({
        kind: 'auth_ready',
        level: 'success',
        backend: 'codex',
        agentName: 'Codex',
      }),
      createEntry({
        kind: 'auth_requested',
        level: 'warning',
        backend: 'codex',
        agentName: 'Codex',
      }),
    ];

    render(<AcpLogsPanel entries={entries} />);

    expect(screen.getByText('Authentication ready for Codex')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    const logsList = screen.getByTestId('acp-logs-list');
    expect(within(logsList).getByText('Authenticate requested for Codex')).toBeInTheDocument();
  });
});
