/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Full-page list of all projects with search and create functionality.
 * Accessible via /projects route and sidebar "Projects" entry.
 */

import { ipcBridge } from '@/common';
import type { IProjectInfo } from '@/common/adapter/ipcBridge';
import CreateProjectModal from '@/renderer/components/project/CreateProjectModal';
import { Button, Input, Empty } from '@arco-design/web-react';
import { FolderOpen, Plus, Search } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styles from './projects.module.css';

const ProjectsListPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<IProjectInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [createModalVisible, setCreateModalVisible] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const list = await ipcBridge.project.list.invoke(undefined as unknown as void);
      setProjects(list || []);
    } catch (error) {
      console.error('[ProjectsListPage] Failed to fetch projects:', error);
    }
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const query = searchQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.directory.toLowerCase().includes(query) ||
        p.description?.toLowerCase().includes(query)
    );
  }, [projects, searchQuery]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t('common.today', { defaultValue: 'Today' });
    if (diffDays === 1) return t('common.yesterday', { defaultValue: 'Yesterday' });
    if (diffDays < 7) return t('common.daysAgo', { defaultValue: '{{count}} days ago', count: diffDays });
    return date.toLocaleDateString();
  };

  const handleProjectClick = (project: IProjectInfo) => {
    void navigate(`/projects/${project.id}`);
  };

  const handleProjectCreated = (project: IProjectInfo) => {
    setProjects((prev) => [project, ...prev]);
    handleProjectClick(project);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('project.pageTitle', { defaultValue: 'Projects' })}</h1>
        <Button
          type='primary'
          icon={<Plus theme='outline' size='14' />}
          onClick={() => setCreateModalVisible(true)}
          style={{ backgroundColor: '#000', borderColor: '#000' }}
        >
          {t('project.newProject', { defaultValue: 'New project' })}
        </Button>
      </div>

      <div className={styles.searchBar}>
        <Input
          prefix={<Search theme='outline' size='16' />}
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('project.searchPlaceholder', { defaultValue: 'Search projects...' })}
          allowClear
        />
      </div>

      {filteredProjects.length === 0 ? (
        <div className={styles.emptyState}>
          <Empty
            description={
              searchQuery.trim()
                ? t('project.noSearchResults', { defaultValue: 'No projects match your search' })
                : t('project.noProjects', { defaultValue: 'No projects yet. Create one to get started.' })
            }
          />
        </div>
      ) : (
        <div className={styles.projectList}>
          {filteredProjects.map((project) => (
            <div key={project.id} className={styles.projectCard} onClick={() => handleProjectClick(project)}>
              <div className={styles.projectIcon}>
                <FolderOpen theme='outline' size='20' fill='var(--color-text-3)' />
              </div>
              <div className={styles.projectInfo}>
                <div className={styles.projectName}>{project.name}</div>
                <div className={styles.projectDirectory}>{project.directory}</div>
                {project.description && <div className={styles.projectDescription}>{project.description}</div>}
              </div>
              <div className={styles.projectDate}>{formatDate(project.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      <CreateProjectModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreated={handleProjectCreated}
      />
    </div>
  );
};

export default ProjectsListPage;
