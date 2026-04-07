/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Modal dialog for creating a new project.
 * Supports two modes:
 *   1. Create a new directory inside the AionUi data root (default)
 *   2. Link to an existing folder on disk via folder picker
 */

import { ipcBridge } from '@/common';
import type { IProjectInfo } from '@/common/adapter/ipcBridge';
import { Input, Message, Modal } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

type CreateProjectModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Called after successful project creation */
  onCreated: (project: IProjectInfo) => void;
};

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [directory, setDirectory] = useState('');
  const [loading, setLoading] = useState(false);

  const handleClose = useCallback(() => {
    setName('');
    setDescription('');
    setDirectory('');
    onClose();
  }, [onClose]);

  /** Open native folder picker and auto-fill name from the folder's basename */
  const handleBrowse = useCallback(async () => {
    try {
      const result = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openDirectory'],
      });
      if (result && result.length > 0) {
        const selectedPath = result[0];
        setDirectory(selectedPath);
        // Auto-fill name from folder basename if name is empty
        if (!name.trim()) {
          const basename = selectedPath.split('/').pop() || selectedPath.split('\\').pop() || '';
          setName(basename);
        }
      }
    } catch (err) {
      console.error('[CreateProjectModal] Failed to open folder picker:', err);
    }
  }, [name]);

  const handleConfirm = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setLoading(true);
    try {
      const project = await ipcBridge.project.create.invoke({
        name: trimmedName,
        description: description.trim() || undefined,
        directory: directory.trim() || undefined,
      });
      Message.success(t('project.createSuccess', { defaultValue: 'Project created' }));
      handleClose();
      onCreated(project);
    } catch (error) {
      console.error('[CreateProjectModal] Failed to create project:', error);
      Message.error(t('project.createFailed', { defaultValue: 'Failed to create project' }));
    } finally {
      setLoading(false);
    }
  }, [name, description, directory, handleClose, onCreated, t]);

  return (
    <Modal
      title={t('project.createTitle', { defaultValue: 'New Project' })}
      visible={visible}
      onOk={() => void handleConfirm()}
      onCancel={handleClose}
      okText={t('common.create', { defaultValue: 'Create' })}
      cancelText={t('common.cancel', { defaultValue: 'Cancel' })}
      confirmLoading={loading}
      okButtonProps={{ disabled: !name.trim() }}
      style={{ borderRadius: '12px' }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      <div className='flex flex-col gap-12px'>
        <div>
          <div className='text-13px text-t-secondary mb-4px'>{t('project.nameLabel', { defaultValue: 'Name' })}</div>
          <Input
            autoFocus
            value={name}
            onChange={setName}
            onPressEnter={() => void handleConfirm()}
            placeholder={t('project.namePlaceholder', { defaultValue: 'e.g. my-saas-app' })}
            allowClear
          />
        </div>

        {/* Folder picker — link to existing directory */}
        <div>
          <div className='text-13px text-t-secondary mb-4px'>
            {t('project.directoryLabel', { defaultValue: 'Folder (optional)' })}
          </div>
          <Input
            value={directory}
            onChange={setDirectory}
            placeholder={t('project.directoryPlaceholder', {
              defaultValue: 'Link to existing folder or leave empty',
            })}
            suffix={
              <FolderOpen
                theme='outline'
                size='16'
                fill='var(--color-text-3)'
                className='cursor-pointer'
                onClick={() => void handleBrowse()}
              />
            }
            allowClear
          />
          {directory && (
            <div className='text-12px text-t-tertiary mt-2px'>
              {t('project.directoryHint', {
                defaultValue: 'Project will link to this folder. Git will be initialized if needed.',
              })}
            </div>
          )}
        </div>

        <div>
          <div className='text-13px text-t-secondary mb-4px'>
            {t('project.descriptionLabel', { defaultValue: 'Description (optional)' })}
          </div>
          <Input.TextArea
            value={description}
            onChange={setDescription}
            placeholder={t('project.descriptionPlaceholder', {
              defaultValue: 'What is this project about?',
            })}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      </div>
    </Modal>
  );
};

export default CreateProjectModal;
