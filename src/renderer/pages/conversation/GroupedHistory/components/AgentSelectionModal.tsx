/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, Modal } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import type { AgentSelectionModalProps } from '../types';
import styles from './AgentSelectionModal.module.css';

const AgentSelectionModal: React.FC<AgentSelectionModalProps> = ({ visible, agents, onSelect, onClose }) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  // Reset search when modal closes
  useEffect(() => {
    if (!visible) setSearchQuery('');
  }, [visible]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const list = q ? agents.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)) : agents;

    const permanent = list.filter((a) => a.employeeType === 'permanent');
    const temporary = list.filter((a) => a.employeeType === 'temporary');
    return { permanent, temporary };
  }, [agents, searchQuery]);

  const getSourceLabel = (source: string): string => {
    if (source === 'preset') return t('dispatch.sidebar.agentSourcePreset');
    if (source === 'custom' || source === 'dispatch_teammate') return t('dispatch.sidebar.agentSourceCustom');
    return t('dispatch.sidebar.agentSourceCli');
  };

  const renderAvatar = (avatar: string | undefined, logo: string | null, name: string) => {
    if (avatar) {
      return (
        <div className={styles.agentAvatar}>
          <span className='text-20px leading-none'>{avatar}</span>
        </div>
      );
    }
    if (logo) {
      return (
        <div className={styles.agentAvatar}>
          <img src={logo} alt={name} className={styles.agentAvatarImg} />
        </div>
      );
    }
    return <div className={styles.agentAvatarLetter}>{name.charAt(0).toUpperCase()}</div>;
  };

  const renderAgentCard = (agent: AgentSelectionModalProps['agents'][number]) => {
    const logo = getAgentLogo(agent.backendType ?? agent.id);
    return (
      <div
        key={agent.id}
        className={styles.agentCard}
        onClick={() => {
          onSelect(agent.id);
        }}
        role='button'
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelect(agent.id);
          }
        }}
      >
        {renderAvatar(agent.avatar, logo, agent.name)}
        <span className={styles.agentName} title={agent.name}>
          {agent.name}
        </span>
        <span className={styles.agentSource}>{getSourceLabel(agent.source)}</span>
      </div>
    );
  };

  const hasPermanent = filtered.permanent.length > 0;
  const hasTemporary = filtered.temporary.length > 0;
  const hasResults = hasPermanent || hasTemporary;

  return (
    <Modal
      visible={visible}
      title={t('dispatch.sidebar.selectAgent')}
      onCancel={onClose}
      footer={null}
      style={{ borderRadius: '12px' }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      <div className={styles.searchWrapper}>
        <Input
          allowClear
          placeholder={t('dispatch.sidebar.searchAgents')}
          value={searchQuery}
          onChange={setSearchQuery}
        />
      </div>

      <div className={styles.scrollBody}>
        {!hasResults && <div className={styles.emptyState}>{t('dispatch.sidebar.noAgentsFound')}</div>}

        {hasPermanent && (
          <div>
            <div className={styles.sectionTitle}>{t('dispatch.sidebar.permanentAgents')}</div>
            <div className={styles.agentGrid}>{filtered.permanent.map(renderAgentCard)}</div>
          </div>
        )}

        {hasTemporary && (
          <div>
            <div className={styles.sectionTitle}>{t('dispatch.sidebar.temporaryAgents')}</div>
            <div className={styles.agentGrid}>{filtered.temporary.map(renderAgentCard)}</div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AgentSelectionModal;
