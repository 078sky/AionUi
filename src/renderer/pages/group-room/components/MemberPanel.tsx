/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Badge } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useGroupRoomContext } from '../context/GroupRoomContext';
import type { GroupMember, GroupMemberStatus } from '../types';

// Deterministic hue from agentType string
function agentTypeToHue(agentType: string): number {
  let hash = 0;
  for (let i = 0; i < agentType.length; i++) {
    hash = agentType.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function statusToBadge(status: GroupMemberStatus): 'processing' | 'success' | 'default' | 'error' | 'warning' {
  switch (status) {
    case 'running':
      return 'processing';
    case 'finished':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
}

const MemberItem: React.FC<{ member: GroupMember }> = ({ member }) => {
  const { t } = useTranslation('conversation');
  const hue = agentTypeToHue(member.agentType);
  const initial = (member.displayName[0] ?? '?').toUpperCase();

  return (
    <div
      className='flex items-center gap-10px px-12px py-8px hover:bg-fill-1 rd-8px transition-colors'
      data-group-room-member='true'
      data-group-room-member-id={member.id}
      data-group-room-member-role={member.role}
      data-group-room-member-status={member.status}
    >
      {/* Avatar */}
      <div
        className='flex-shrink-0 size-32px rd-full flex items-center justify-center text-12px font-600 color-white'
        style={{ backgroundColor: `hsl(${hue}, 60%, 48%)` }}
      >
        {initial}
      </div>

      {/* Name + task */}
      <div className='flex flex-col min-w-0 flex-1'>
        <div className='flex items-center gap-6px'>
          <span className='text-13px font-500 color-text-1 truncate'>{member.displayName}</span>
          <span className='flex-shrink-0 text-11px color-text-3 bg-fill-2 px-4px py-1px rd-4px'>
            {member.role === 'host'
              ? t('groupRoom.roleHost', { defaultValue: '群主' })
              : t('groupRoom.roleSub', { defaultValue: '成员' })}
          </span>
        </div>
        {member.currentTask && <span className='text-11px color-text-3 truncate mt-1px'>{member.currentTask}</span>}
      </div>

      {/* Status badge */}
      <Badge status={statusToBadge(member.status)} className='flex-shrink-0' />
    </div>
  );
};

const MemberPanel: React.FC = () => {
  const { t } = useTranslation('conversation');
  const { members } = useGroupRoomContext();

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      <div className='px-16px py-12px border-b-1 border-b-solid border-b-border-2 flex-shrink-0'>
        <span className='text-13px font-600 color-text-1'>{t('groupRoom.membersTitle', { defaultValue: '成员' })}</span>
        <span className='ml-6px text-12px color-text-3'>({members.length})</span>
      </div>

      <div className='flex-1 overflow-y-auto px-4px py-8px'>
        {members.length === 0 ? (
          <div className='flex items-center justify-center h-80px'>
            <span className='text-13px color-text-3'>{t('groupRoom.noMembers', { defaultValue: '暂无成员' })}</span>
          </div>
        ) : (
          members.map((member) => <MemberItem key={member.id} member={member} />)
        )}
      </div>
    </div>
  );
};

export default MemberPanel;
