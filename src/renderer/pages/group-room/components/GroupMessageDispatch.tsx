/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import MarkdownView from '@renderer/components/Markdown';
import React from 'react';

export type GroupMessageDispatchProps = {
  senderName: string;
  targetName: string;
  content: string;
  streaming?: boolean;
};

/**
 * Host agent dispatch task message bubble.
 * Visual: blue left-border card.
 */
const GroupMessageDispatch: React.FC<GroupMessageDispatchProps> = ({ senderName, targetName, content }) => {
  const showRoute = !!senderName || !!targetName;

  return (
    <div
      className='min-w-0 w-full'
      data-group-room-message-kind='dispatch'
      style={{
        borderLeft: '3px solid rgb(var(--primary-6))',
        background: 'var(--color-primary-light-1)',
        padding: '8px 12px',
        borderRadius: '0 8px 8px 8px',
      }}
    >
      {showRoute && (
        <div className='text-12px text-t-secondary mb-4px'>
          {'\u2192'} {senderName} {'\u2192'} {targetName}
        </div>
      )}
      <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{content}</MarkdownView>
    </div>
  );
};

export default GroupMessageDispatch;
