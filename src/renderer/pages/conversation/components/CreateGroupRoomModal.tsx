/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Form, Input, Message, Modal } from '@arco-design/web-react';
import { Robot } from '@icon-park/react';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { getAgentLogo } from '@/renderer/utils/model/agentLogo';
import type { AvailableAgent, AcpBackend } from '@/renderer/pages/guid/types';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { emitter } from '@/renderer/utils/emitter';
import useSWR from 'swr';

type CreateGroupRoomModalProps = {
  visible: boolean;
  onClose: () => void;
};

type FormValues = {
  name: string;
  description?: string;
};

const getAgentKey = (agent: { backend: AcpBackend; customAgentId?: string }): string => {
  if (agent.backend === 'custom' && agent.customAgentId) {
    return `custom:${agent.customAgentId}`;
  }
  if (agent.backend === 'remote' && agent.customAgentId) {
    return `remote:${agent.customAgentId}`;
  }
  return agent.backend;
};

const CreateGroupRoomModal: React.FC<CreateGroupRoomModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const { data: availableAgentsData } = useSWR(
    visible ? 'acp.agents.available' : null,
    async () => {
      const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
      if (result.success) {
        return result.data.filter((agent) => !(agent.backend === 'gemini' && agent.cliPath));
      }
      return [];
    },
    {
      revalidateOnFocus: false,
      refreshInterval: (data) => (visible && (!data || data.length === 0) ? 1000 : 0),
      dedupingInterval: 300,
    }
  );

  const displayAgents: AvailableAgent[] = (availableAgentsData ?? []).filter(
    (agent) => agent.backend !== 'custom' || agent.isExtension
  );

  const handleClose = useCallback(() => {
    form.resetFields();
    setSelectedAgentKey('');
    onClose();
  }, [form, onClose]);

  const handleConfirm = useCallback(async () => {
    try {
      const values = await form.validate();
      if (!selectedAgentKey) {
        return;
      }
      setLoading(true);

      const result = await ipcBridge.groupRoom.create.invoke({
        name: values.name.trim(),
        desc: values.description?.trim() ?? '',
        hostBackend: selectedAgentKey,
      });

      if (result.success && result.data) {
        handleClose();
        emitter.emit('chat.history.refresh');
        void navigate(`/group-room/${result.data.id}`);
      } else {
        Message.error(t('groupRoom.createFailed', { defaultValue: '创建群聊室失败，请重试' }));
      }
    } catch {
      // Form validation failed — do nothing
    } finally {
      setLoading(false);
    }
  }, [form, selectedAgentKey, handleClose, navigate]);

  return (
    <Modal
      title={t('conversation.groupRoom.createTitle')}
      visible={visible}
      onCancel={handleClose}
      footer={null}
      style={{ borderRadius: '12px' }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      <div data-group-room-create-modal='true'>
        <Form form={form} layout='vertical' className='mt-4px'>
          <Form.Item
            field='name'
            label={t('conversation.groupRoom.nameLabel')}
            rules={[{ required: true, message: t('conversation.groupRoom.nameRequired') }]}
          >
            <Input
              placeholder={t('conversation.groupRoom.namePlaceholder')}
              maxLength={60}
              showWordLimit
              allowClear
              data-group-room-name-input='true'
            />
          </Form.Item>

          <Form.Item field='description' label={t('conversation.groupRoom.descriptionLabel')}>
            <Input.TextArea
              placeholder={t('conversation.groupRoom.descriptionPlaceholder')}
              maxLength={200}
              showWordLimit
              autoSize={{ minRows: 2, maxRows: 4 }}
              data-group-room-description-input='true'
            />
          </Form.Item>

          <Form.Item label={t('conversation.groupRoom.mainAgentLabel')}>
            <div className='flex flex-wrap gap-8px' style={{ padding: '8px 0' }}>
              {displayAgents.length === 0 && (
                <span className='text-14px' style={{ color: 'var(--color-text-3)' }}>
                  {t('conversation.groupRoom.noAgents')}
                </span>
              )}
              {displayAgents.map((agent) => {
                const key = getAgentKey(agent);
                const isSelected = selectedAgentKey === key;
                const extensionAvatar = resolveExtensionAssetUrl(agent.isExtension ? agent.avatar : undefined);
                const emojiAvatar = agent.backend === 'remote' && agent.avatar ? agent.avatar : undefined;
                const logoSrc = extensionAvatar || (!emojiAvatar ? getAgentLogo(agent.backend) : undefined);

                return (
                  <div
                    key={key}
                    className='flex items-center gap-6px px-12px py-6px rd-20px cursor-pointer transition-all'
                    data-agent-pill='true'
                    data-agent-backend={agent.backend}
                    data-agent-key={key}
                    data-agent-selected={isSelected ? 'true' : 'false'}
                    data-group-room-agent-pill='true'
                    style={{
                      border: isSelected ? '1.5px solid rgb(var(--primary-6))' : '1.5px solid var(--color-border-2)',
                      backgroundColor: isSelected ? 'rgba(var(--primary-6), 0.1)' : 'var(--color-fill-1)',
                      color: isSelected ? 'rgb(var(--primary-6))' : 'var(--color-text-1)',
                    }}
                    onClick={() => setSelectedAgentKey(key)}
                  >
                    {emojiAvatar ? (
                      <span style={{ fontSize: 16, lineHeight: 1 }}>{emojiAvatar}</span>
                    ) : logoSrc ? (
                      <img
                        src={logoSrc}
                        alt={`${agent.backend} logo`}
                        width={16}
                        height={16}
                        style={{ objectFit: 'contain' }}
                      />
                    ) : (
                      <Robot theme='outline' size={16} fill='currentColor' />
                    )}
                    <span className='text-13px font-medium'>{agent.name}</span>
                  </div>
                );
              })}
            </div>
            {!selectedAgentKey && (
              <div className='text-12px mt-4px' style={{ color: 'var(--color-danger-6, var(--color-danger))' }}>
                {t('conversation.groupRoom.mainAgentRequired')}
              </div>
            )}
          </Form.Item>
        </Form>

        <div className='flex gap-12px justify-end mt-16px'>
          <Button onClick={handleClose} data-group-room-cancel='true'>
            {t('common.cancel')}
          </Button>
          <Button
            type='primary'
            loading={loading}
            disabled={!selectedAgentKey}
            onClick={() => void handleConfirm()}
            data-group-room-confirm='true'
          >
            {t('common.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default CreateGroupRoomModal;
