/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoisted mocks
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

import GroupRoomSendBox from '../../../src/renderer/pages/group-room/components/GroupRoomSendBox';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

function getSendButton(): HTMLButtonElement {
  return screen.getByRole('button') as HTMLButtonElement;
}

// ---------------------------------------------------------------------------
// Case 17: User input triggers host agent
// ---------------------------------------------------------------------------

describe('Case 17: user input triggers host agent', () => {
  let onSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSend = vi.fn();
  });

  it('textarea value updates when user types', async () => {
    const user = userEvent.setup();
    render(<GroupRoomSendBox onSend={onSend} />);
    const textarea = getTextarea();

    await user.type(textarea, 'hello world');
    expect(textarea.value).toBe('hello world');
  });

  it('Enter key calls onSend with trimmed text and clears input', () => {
    render(<GroupRoomSendBox onSend={onSend} />);
    const textarea = getTextarea();

    // Arco TextArea onChange passes value directly; simulate via fireEvent
    fireEvent.change(textarea, { target: { value: '  hello  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello');
    // After send, value should be cleared
    expect(textarea.value).toBe('');
  });

  it('Shift+Enter does not trigger send', () => {
    render(<GroupRoomSendBox onSend={onSend} />);
    const textarea = getTextarea();

    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('empty input Enter does not trigger onSend', () => {
    render(<GroupRoomSendBox onSend={onSend} />);
    const textarea = getTextarea();

    // Leave empty
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    // Whitespace-only
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 18: Sub-agent tab is read-only
// ---------------------------------------------------------------------------

describe('Case 18: sub-agent tab read-only (disabled)', () => {
  let onSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSend = vi.fn();
  });

  it('disabled=true makes textarea disabled', () => {
    render(<GroupRoomSendBox onSend={onSend} disabled />);
    expect(getTextarea()).toBeDisabled();
  });

  it('disabled=true Enter does not trigger onSend', () => {
    render(<GroupRoomSendBox onSend={onSend} disabled />);
    const textarea = getTextarea();

    fireEvent.change(textarea, { target: { value: 'attempt' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('disabled=true makes send button disabled', () => {
    render(<GroupRoomSendBox onSend={onSend} disabled />);
    expect(getSendButton()).toBeDisabled();
  });

  it('loading=true prevents send', () => {
    render(<GroupRoomSendBox onSend={onSend} loading />);
    const textarea = getTextarea();

    fireEvent.change(textarea, { target: { value: 'attempt' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 19 partial: input lock
// ---------------------------------------------------------------------------

describe('Case 19 partial: input lock', () => {
  let onSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSend = vi.fn();
  });

  it('loading=true makes textarea disabled', () => {
    render(<GroupRoomSendBox onSend={onSend} loading />);
    expect(getTextarea()).toBeDisabled();
  });

  it('loading=false + disabled=false allows normal input and send', () => {
    render(<GroupRoomSendBox onSend={onSend} />);
    const textarea = getTextarea();

    expect(textarea).not.toBeDisabled();

    fireEvent.change(textarea, { target: { value: 'go' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('go');
  });
});
