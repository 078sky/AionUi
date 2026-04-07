/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dropdown selector to choose a project for the current conversation.
 * Shows "Work in a project" when no project selected, or the project name when selected.
 * Includes a "+" button to create a new project inline.
 */

import { ipcBridge } from '@/common';
import type { IProjectInfo } from '@/common/adapter/ipcBridge';
import { iconColors } from '@/renderer/styles/colors';
import CreateProjectModal from '@/renderer/components/project/CreateProjectModal';
import { Button, Dropdown, Menu, Tooltip } from '@arco-design/web-react';
import { Close, Down, FolderOpen, Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ProjectSelectorProps = {
  /** Currently selected project ID (undefined = no project) */
  selectedProjectId?: string;
  /** Currently selected project name (for display) */
  selectedProjectName?: string;
  /** Called when user picks a project */
  onProjectSelect: (projectId: string, projectName: string) => void;
  /** Called when user clears project selection */
  onProjectClear: () => void;
};

const ProjectSelector: React.FC<ProjectSelectorProps> = ({
  selectedProjectId,
  selectedProjectName,
  onProjectSelect,
  onProjectClear,
}) => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<IProjectInfo[]>([]);
  const [createVisible, setCreateVisible] = useState(false);

  // Fetch projects list when dropdown is about to open
  const fetchProjects = useCallback(async () => {
    try {
      const list = await ipcBridge.project.list.invoke(undefined as unknown as void);
      setProjects(list || []);
    } catch (err) {
      console.error('[ProjectSelector] Failed to fetch projects:', err);
    }
  }, []);

  // Pre-fetch on mount so first open is instant
  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  const handleCreated = (project: IProjectInfo) => {
    setProjects((prev) => [project, ...prev]);
    onProjectSelect(project.id, project.name);
  };

  const menuContent = (
    <Menu
      className='min-w-200px max-h-300px overflow-y-auto'
      onClickMenuItem={(key) => {
        if (key === '__create__') {
          setCreateVisible(true);
          return;
        }
        const project = projects.find((p) => p.id === key);
        if (project) {
          onProjectSelect(project.id, project.name);
        }
      }}
    >
      {projects.map((p) => (
        <Menu.Item key={p.id}>
          <div className='flex items-center gap-8px'>
            <FolderOpen
              theme='outline'
              size='14'
              fill={iconColors.secondary}
              style={{ lineHeight: 0, flexShrink: 0 }}
            />
            <span className='truncate'>{p.name}</span>
          </div>
        </Menu.Item>
      ))}
      {projects.length > 0 && (
        <Menu.Item
          key='__divider__'
          disabled
          style={{ height: 1, padding: 0, margin: '4px 0', background: 'var(--color-border-2)' }}
        />
      )}
      <Menu.Item key='__create__'>
        <div className='flex items-center gap-8px'>
          <Plus theme='outline' size='14' fill={iconColors.secondary} style={{ lineHeight: 0, flexShrink: 0 }} />
          <span>{t('project.newProject', { defaultValue: 'New project' })}</span>
        </div>
      </Menu.Item>
    </Menu>
  );

  return (
    <>
      <div className='flex items-center gap-2px'>
        <Dropdown
          trigger='click'
          droplist={menuContent}
          onVisibleChange={(visible) => {
            if (visible) void fetchProjects();
          }}
        >
          <Button type='text' size='mini' style={{ color: 'var(--color-text-2)', padding: '0 8px', height: '28px' }}>
            <span className='flex items-center gap-4px'>
              <FolderOpen theme='outline' size='14' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
              <span style={{ fontSize: '13px' }}>
                {selectedProjectId && selectedProjectName
                  ? selectedProjectName
                  : t('project.workInProject', { defaultValue: 'Work in a project' })}
              </span>
              <Down theme='outline' size='12' fill='currentColor' />
            </span>
          </Button>
        </Dropdown>

        {/* Clear button when a project is selected */}
        {selectedProjectId && (
          <Tooltip content={t('project.clearProject', { defaultValue: 'Remove project' })}>
            <Button
              type='text'
              size='mini'
              shape='circle'
              style={{ width: '20px', height: '20px', minWidth: '20px' }}
              icon={<Close theme='outline' size='12' fill='var(--color-text-3)' />}
              onClick={(e) => {
                e.stopPropagation();
                onProjectClear();
              }}
            />
          </Tooltip>
        )}
      </div>

      <CreateProjectModal visible={createVisible} onClose={() => setCreateVisible(false)} onCreated={handleCreated} />
    </>
  );
};

export default ProjectSelector;
