/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export type GroupSystemMessageProps = {
  /** Plain text content, i18n handled by the caller */
  content: string;
};

/**
 * System message rendered as a centered divider line with text.
 * Used for join/leave/task-start/task-end events.
 */
const GroupSystemMessage: React.FC<GroupSystemMessageProps> = ({ content }) => {
  return (
    <div className='flex items-center gap-8px w-full py-4px'>
      <div className='flex-1 border-t border-b-1' />
      <span className='text-12px text-t-secondary shrink-0'>{content}</span>
      <div className='flex-1 border-t border-b-1' />
    </div>
  );
};

export default GroupSystemMessage;
