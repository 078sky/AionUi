/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import CollapsibleContent from '@renderer/components/chat/CollapsibleContent';
import { Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type GroupThinkingBlockProps = {
  agentName: string;
  content: string;
  running: boolean;
  elapsedSeconds?: number;
};

/**
 * Sub-agent thinking process block.
 * Rendered as a standalone message row (not as a floating overlay).
 */
const GroupThinkingBlock: React.FC<GroupThinkingBlockProps> = ({ agentName, content, running, elapsedSeconds }) => {
  const { t } = useTranslation();

  const headerLabel = running
    ? `${agentName} \u00B7 ${t('conversation.groupRoom.msg.thinking')}`
    : `${agentName} \u00B7 ${t('conversation.groupRoom.msg.thinkingDone', { seconds: elapsedSeconds ?? 0 })}`;

  return (
    <div className='min-w-0 w-full px-10px py-8px rd-8px bg-2' data-group-room-message-kind='thinking'>
      <div className='flex items-center gap-6px mb-4px'>
        {running && <Spin size={12} />}
        <span className='text-12px text-t-secondary'>{headerLabel}</span>
      </div>
      {content ? (
        <CollapsibleContent maxHeight={84} defaultCollapsed={true}>
          <div className='text-12px text-t-tertiary whitespace-pre-wrap [word-break:break-word]'>{content}</div>
        </CollapsibleContent>
      ) : null}
    </div>
  );
};

export default GroupThinkingBlock;
