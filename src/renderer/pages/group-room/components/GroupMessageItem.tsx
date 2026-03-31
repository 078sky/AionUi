/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import MarkdownView from '@renderer/components/Markdown';
import { Tag } from '@arco-design/web-react';
import React from 'react';
import type { GroupMember, GroupMessage } from '../types';
import GroupMessageDispatch from './GroupMessageDispatch';
import GroupMessageReport from './GroupMessageReport';
import GroupSystemMessage from './GroupSystemMessage';
import GroupThinkingBlock from './GroupThinkingBlock';

export type GroupMessageItemProps = {
  message: GroupMessage;
  /** Used to resolve senderName and targetName from ids */
  members: GroupMember[];
};

const findName = (members: GroupMember[], id: string | null): string => {
  if (!id) return '';
  return members.find((m) => m.id === id)?.displayName ?? id;
};

/**
 * Message router: renders the correct bubble component based on msgKind.
 */
const GroupMessageItem: React.FC<GroupMessageItemProps> = ({ message, members }) => {
  const senderName = message.senderName ?? findName(members, message.senderId);
  const targetName = message.targetName ?? '';

  switch (message.msgKind) {
    case 'user_input':
      return (
        <div className='flex justify-end w-full'>
          <div
            className='max-w-[78%] bg-aou-2 p-8px text-t-primary [word-break:break-word]'
            style={{ borderRadius: '8px 0 8px 8px' }}
          >
            <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{message.content}</MarkdownView>
          </div>
        </div>
      );

    case 'host_response':
      return (
        <div className='flex flex-col gap-4px w-full'>
          {senderName && (
            <Tag size='small' className='self-start'>
              {senderName}
            </Tag>
          )}
          <div className='min-w-0 w-full'>
            <MarkdownView codeStyle={{ marginTop: 4, marginBlock: 4 }}>{message.content}</MarkdownView>
          </div>
        </div>
      );

    case 'host_thought':
      return (
        <GroupThinkingBlock
          agentName={senderName || message.senderId || message.targetId || ''}
          content={message.content}
          running={message.streaming}
        />
      );

    case 'host_dispatch':
      return (
        <GroupMessageDispatch
          senderName={senderName}
          targetName={targetName}
          content={message.content}
          streaming={message.streaming}
        />
      );

    case 'result_injection':
      return (
        <GroupMessageReport
          senderName={senderName}
          targetName={targetName}
          content={message.content}
          streaming={message.streaming}
        />
      );

    case 'sub_thinking':
      return <GroupThinkingBlock agentName={senderName} content={message.content} running={message.streaming} />;

    case 'sub_output':
      return (
        <GroupMessageReport
          senderName={senderName}
          targetName={targetName}
          content={message.content}
          streaming={message.streaming}
        />
      );

    case 'system':
    case 'sub_status':
    case 'agent_join':
      return <GroupSystemMessage content={message.content} />;

    default:
      return null;
  }
};

export default GroupMessageItem;
