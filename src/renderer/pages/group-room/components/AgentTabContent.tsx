/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useTranslation } from 'react-i18next';
import type { GroupMember, GroupMessage } from '../types';
import GroupMessageItem from './GroupMessageItem';

export type AgentTabContentProps = {
  messages: GroupMessage[];
  members: GroupMember[];
};

/**
 * Read-only message list used inside member tabs.
 * No send box — input is only available in the main conversation tab.
 */
const AgentTabContent: React.FC<AgentTabContentProps> = ({ messages, members }) => {
  const { t } = useTranslation('conversation');
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    if (messages.length === 0) return;
    virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className='flex items-center justify-center h-full'>
        <span className='text-13px color-text-3'>{t('groupRoom.messagesEmpty', { defaultValue: '暂无消息' })}</span>
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className='h-full'
      data={messages}
      initialTopMostItemIndex={messages.length - 1}
      followOutput='smooth'
      atBottomThreshold={80}
      increaseViewportBy={200}
      itemContent={(_index, msg) => (
        <div key={msg.id} className='px-16px py-6px'>
          <GroupMessageItem message={msg} members={members} />
        </div>
      )}
      components={{
        Header: () => <div className='h-12px' />,
        Footer: () => <div className='h-12px' />,
      }}
    />
  );
};

export default AgentTabContent;
