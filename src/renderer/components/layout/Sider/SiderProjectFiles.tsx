/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * File tree for the active project, shown in the sidebar
 * when the user is on a /projects/:id route.
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile, IProjectInfo } from '@/common/adapter/ipcBridge';
import { FolderOpen, FileCode, Right, Down } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { Spin } from '@arco-design/web-react';

interface SiderProjectFilesProps {
  projectId: string;
  collapsed: boolean;
}

const FileTreeNode: React.FC<{ node: IDirOrFile; depth: number }> = ({ node, depth }) => {
  const [expanded, setExpanded] = useState(false);

  if (node.isDir) {
    return (
      <div>
        <div
          className='flex items-center gap-4px py-3px px-8px cursor-pointer hover:bg-fill-2 rd-4px text-13px text-t-primary select-none'
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className='shrink-0 flex items-center' style={{ width: '14px' }}>
            {expanded ? (
              <Down theme='outline' size='12' fill='currentColor' />
            ) : (
              <Right theme='outline' size='12' fill='currentColor' />
            )}
          </span>
          <FolderOpen theme='outline' size='14' fill='var(--color-text-3)' className='shrink-0' />
          <span className='truncate'>{node.name}</span>
        </div>
        {expanded &&
          node.children?.map((child) => <FileTreeNode key={child.fullPath} node={child} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div
      className='flex items-center gap-4px py-3px px-8px text-13px text-t-secondary select-none truncate'
      style={{ paddingLeft: `${8 + depth * 14 + 14}px` }}
    >
      <FileCode theme='outline' size='14' fill='var(--color-text-4)' className='shrink-0' />
      <span className='truncate'>{node.name}</span>
    </div>
  );
};

const SiderProjectFiles: React.FC<SiderProjectFilesProps> = ({ projectId, collapsed }) => {
  const [project, setProject] = useState<IProjectInfo | null>(null);
  const [files, setFiles] = useState<IDirOrFile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFiles = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const proj = await ipcBridge.project.get.invoke({ id: projectId });
      setProject(proj);
      if (proj?.directory) {
        const tree = await ipcBridge.fs.getFilesByDir.invoke({ dir: proj.directory, root: proj.directory });
        setFiles(tree || []);
      }
    } catch (error) {
      console.error('[SiderProjectFiles] Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles]);

  if (collapsed || !project) return null;

  return (
    <div className='flex-1 min-h-0 overflow-y-auto'>
      <div className='flex items-center px-12px py-8px'>
        <span className='text-13px text-t-secondary font-bold leading-20px truncate'>{project.name}</span>
      </div>
      {loading ? (
        <div className='flex items-center justify-center py-24px'>
          <Spin size={16} />
        </div>
      ) : files.length === 0 ? (
        <div className='text-12px text-t-tertiary px-12px py-8px'>No files</div>
      ) : (
        <div className='pb-8px'>
          {files.map((node) =>
            node.children ? (
              node.children.map((child) => <FileTreeNode key={child.fullPath} node={child} depth={0} />)
            ) : (
              <FileTreeNode key={node.fullPath} node={node} depth={0} />
            )
          )}
        </div>
      )}
    </div>
  );
};

export default SiderProjectFiles;
