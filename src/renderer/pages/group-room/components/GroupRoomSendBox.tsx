/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight send box for GroupRoom — no PreviewContext / ConversationContext dependency.
 * Full-featured version should be wired up by 老锤 after review.
 */

import { Button, Input } from '@arco-design/web-react';
import { ArrowUp } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type GroupRoomSendBoxProps = {
  onSend: (message: string) => void;
  disabled?: boolean;
  loading?: boolean;
};

const GroupRoomSendBox: React.FC<GroupRoomSendBoxProps> = ({ onSend, disabled, loading }) => {
  const { t } = useTranslation('conversation');
  const [value, setValue] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || loading) return;
    onSend(trimmed);
    setValue('');
  }, [value, disabled, loading, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const isEmpty = !value.trim();

  return (
    <div className='px-16px pb-16px pt-8px' data-group-room-sendbox='true'>
      <div className='relative flex items-end gap-8px p-12px bg-dialog-fill-0 b-1 b-solid b-border-2 rd-16px'>
        <Input.TextArea
          value={value}
          disabled={disabled || loading}
          placeholder={t('groupRoom.inputPlaceholder', { defaultValue: '发送消息…' })}
          data-group-room-input='true'
          className='flex-1 !b-none !shadow-none !bg-transparent !resize-none text-14px lh-20px'
          style={{ minHeight: '20px', maxHeight: '120px' }}
          autoSize={{ minRows: 1, maxRows: 6 }}
          onChange={setValue}
          onKeyDown={handleKeyDown}
        />
        <Button
          shape='circle'
          type='primary'
          disabled={isEmpty || disabled}
          style={{
            backgroundColor: isEmpty || disabled ? undefined : '#000000',
            borderColor: isEmpty || disabled ? undefined : '#000000',
            flexShrink: 0,
          }}
          data-group-room-send='true'
          icon={<ArrowUp theme='filled' size='14' fill='white' strokeWidth={5} />}
          onClick={handleSend}
        />
      </div>
    </div>
  );
};

export default GroupRoomSendBox;
