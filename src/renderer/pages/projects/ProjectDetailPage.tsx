/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Project detail page — shows project info and its conversations.
 * The sidebar displays the project's file tree when this page is active.
 */

import { ipcBridge } from '@/common';
import type { IProjectInfo } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import CreateProjectModal from '@/renderer/components/project/CreateProjectModal';
import { Button, Empty, Spin } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './projects.module.css';

const ProjectDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [project, setProject] = useState<IProjectInfo | null>(null);
  const [conversations, setConversations] = useState<TChatConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProject = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [proj, convs] = await Promise.all([
        ipcBridge.project.get.invoke({ id }),
        ipcBridge.project.getConversations.invoke({ projectId: id }),
      ]);
      setProject(proj);
      setConversations(convs || []);
    } catch (error) {
      console.error('[ProjectDetailPage] Failed to fetch project:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchProject();
  }, [fetchProject]);

  const handleNewConversation = () => {
    if (!project) return;
    void navigate('/guid', { state: { projectId: project.id, projectName: project.name } });
  };

  const handleConversationClick = (conv: TChatConversation) => {
    void navigate(`/conversation/${conv.id}`);
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className='flex items-center justify-center py-64px'>
          <Spin size={24} />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.container}>
        <Empty description={t('project.notFound', { defaultValue: 'Project not found' })} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{project.name}</h1>
          {project.description && (
            <div className='text-13px text-t-secondary mt-4px'>{project.description}</div>
          )}
          <div className='text-12px text-t-tertiary mt-2px'>{project.directory}</div>
        </div>
        <Button
          type='primary'
          icon={<Plus theme='outline' size='14' />}
          onClick={handleNewConversation}
          style={{ backgroundColor: '#000', borderColor: '#000' }}
        >
          {t('project.newConversation', { defaultValue: 'New conversation' })}
        </Button>
      </div>

      {conversations.length === 0 ? (
        <div className={styles.emptyState}>
          <Empty
            description={t('project.noConversations', {
              defaultValue: 'No conversations yet. Start one to begin.',
            })}
          />
        </div>
      ) : (
        <div className={styles.projectList}>
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={styles.projectCard}
              onClick={() => handleConversationClick(conv)}
            >
              <div className={styles.projectInfo}>
                <div className={styles.projectName}>{conv.title || t('common.untitled', { defaultValue: 'Untitled' })}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectDetailPage;
