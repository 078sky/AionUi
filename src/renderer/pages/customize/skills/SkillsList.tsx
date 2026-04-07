/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Middle panel for Skills tab — shows grouped skill list
 * with expandable file trees for each skill directory.
 *
 * Groups: "Personal skills" (isCustom) / "Built-in skills" (!isCustom)
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';
import { Input, Message, Modal } from '@arco-design/web-react';
import { Right, FolderOpen, FileText, Lightning, Plus } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../customize.module.css';

/** Skill entry returned by listAvailableSkills IPC */
interface SkillInfo {
  name: string;
  description: string;
  /** Path to SKILL.md */
  location: string;
  isCustom: boolean;
}

interface SkillsListProps {
  /** Currently selected file path (highlighted in tree) */
  selectedFilePath: string | null;
  /** Callback when a file is selected for preview */
  onFileSelect: (filePath: string, skillName: string) => void;
}

/**
 * Derive the skill directory from the SKILL.md location path.
 * location is always an absolute path ending with /SKILL.md
 */
function skillDirFromLocation(location: string): string {
  return location.replace(/[/\\]SKILL\.md$/i, '');
}

const SkillsList: React.FC<SkillsListProps> = ({ selectedFilePath, onFileSelect }) => {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Track which multi-file skills are expanded
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  // Cache of file trees per skill name (children only, root unwrapped)
  const [fileTrees, setFileTrees] = useState<Record<string, IDirOrFile[]>>({});
  // Track collapsed groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Track which directory paths are expanded in file trees
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // Import skill modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importing, setImporting] = useState(false);

  // Load skills list on mount, then eagerly load all file trees
  useEffect(() => {
    const load = async () => {
      try {
        const result = await ipcBridge.fs.listAvailableSkills.invoke();
        const loadedSkills = result ?? [];
        setSkills(loadedSkills);

        // Eagerly load file trees for all skills to avoid async flash on click
        const treeEntries = await Promise.all(
          loadedSkills.map(async (skill) => {
            const skillDir = skillDirFromLocation(skill.location);
            try {
              const rawTree = await ipcBridge.fs.getFilesByDir.invoke({ dir: skillDir, root: skillDir });
              // Unwrap root directory node
              const children =
                rawTree && rawTree.length === 1 && rawTree[0].isDir ? (rawTree[0].children ?? []) : (rawTree ?? []);
              return [skill.name, children] as const;
            } catch {
              return [skill.name, []] as const;
            }
          })
        );
        setFileTrees(Object.fromEntries(treeEntries));

        // Auto-select the first skill's SKILL.md so preview isn't empty
        // Prioritize personal skills, fall back to built-in
        const firstSkill = loadedSkills.find((s) => s.isCustom) ?? loadedSkills[0];
        if (firstSkill) {
          onFileSelect(firstSkill.location, firstSkill.name);
        }
      } catch (error) {
        console.error('[SkillsList] Failed to load skills:', error);
      } finally {
        setLoading(false);
      }
    };
    void load();
    // onFileSelect is stable (from parent useState setter) — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Determine if a skill directory has more than just SKILL.md.
   * If only SKILL.md exists → single-file skill (no tree needed).
   */
  const isMultiFileSkill = useCallback(
    (skillName: string): boolean => {
      const tree = fileTrees[skillName];
      if (!tree) return false;
      // More than 1 entry, or any directory → multi-file
      if (tree.length > 1) return true;
      if (tree.length === 1 && tree[0].isDir) return true;
      return false;
    },
    [fileTrees]
  );

  const handleSkillClick = useCallback(
    (skill: SkillInfo) => {
      if (isMultiFileSkill(skill.name)) {
        // Multi-file skill: always expand (show contents alongside preview)
        setExpandedSkills((prev) => {
          const next = new Set(prev);
          next.add(skill.name);
          return next;
        });
      }
      // Always select SKILL.md for preview on click
      onFileSelect(skill.location, skill.name);
    },
    [isMultiFileSkill, onFileSelect]
  );

  /** Toggle expand/collapse via chevron only */
  const toggleSkillExpand = useCallback((skillName: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skillName)) {
        next.delete(skillName);
      } else {
        next.add(skillName);
      }
      return next;
    });
  }, []);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Split into groups — memoized to avoid re-filtering on each render
  const personalSkills = useMemo(() => skills.filter((s) => s.isCustom), [skills]);
  const builtinSkills = useMemo(() => skills.filter((s) => !s.isCustom), [skills]);

  /** Toggle a directory node expanded/collapsed */
  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  /** Render a file tree node recursively */
  const renderFileNode = (node: IDirOrFile, skillName: string, depth: number = 0) => {
    const isSelected = selectedFilePath === node.fullPath;

    if (node.isDir) {
      const isDirExpanded = expandedDirs.has(node.fullPath);
      const hasChildren = node.children && node.children.length > 0;

      return (
        <React.Fragment key={node.fullPath}>
          <div
            className={classNames(styles.fileItem, styles.fileItemDir)}
            style={{ paddingLeft: `${32 + depth * 16}px` }}
            onClick={() => toggleDir(node.fullPath)}
          >
            <span className={styles.fileItemIcon}>
              <FolderOpen theme='outline' size='14' />
            </span>
            <span className='flex-1 truncate'>{node.name}</span>
            {hasChildren && (
              <span className={classNames(styles.groupChevron, isDirExpanded && styles.groupChevronOpen)}>
                <Right theme='outline' size='10' />
              </span>
            )}
          </div>
          {isDirExpanded && node.children?.map((child) => renderFileNode(child, skillName, depth + 1))}
        </React.Fragment>
      );
    }

    return (
      <div
        key={node.fullPath}
        className={classNames(styles.fileItem, isSelected && styles.fileItemActive)}
        style={{ paddingLeft: `${32 + depth * 16}px` }}
        onClick={() => onFileSelect(node.fullPath, skillName)}
      >
        <span className={styles.fileItemIcon}>
          <FileText theme='outline' size='14' />
        </span>
        <span>{node.name}</span>
      </div>
    );
  };

  /** Render a group of skills with collapsible header */
  const renderGroup = (groupId: string, label: string, groupSkills: SkillInfo[]) => {
    if (groupSkills.length === 0) return null;
    const isCollapsed = collapsedGroups.has(groupId);

    return (
      <div key={groupId}>
        <div className={styles.groupHeader} onClick={() => toggleGroup(groupId)}>
          <span className={classNames(styles.groupChevron, !isCollapsed && styles.groupChevronOpen)}>
            <Right theme='outline' size='12' />
          </span>
          <span>{label}</span>
        </div>
        {!isCollapsed &&
          groupSkills.map((skill) => {
            const isExpanded = expandedSkills.has(skill.name);
            const tree = fileTrees[skill.name];
            const hasMultipleFiles = isMultiFileSkill(skill.name);
            // Highlight if SKILL.md of this skill is selected, or any nested file
            const skillDir = skillDirFromLocation(skill.location);
            const isSelected =
              selectedFilePath === skill.location ||
              (selectedFilePath !== null && selectedFilePath.startsWith(skillDir + '/'));

            return (
              <React.Fragment key={skill.name}>
                {/* Skill entry */}
                <div
                  className={classNames(styles.skillItem, isSelected && styles.skillItemActive)}
                  onClick={() => handleSkillClick(skill)}
                >
                  <span className={styles.skillItemIcon}>
                    <Lightning theme='outline' size='14' />
                  </span>
                  <span className='flex-1 truncate'>{skill.name}</span>
                  {/* Show expand chevron only for multi-file skills */}
                  {hasMultipleFiles && (
                    <span
                      className={classNames(styles.groupChevron, isExpanded && styles.groupChevronOpen)}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSkillExpand(skill.name);
                      }}
                    >
                      <Right theme='outline' size='10' />
                    </span>
                  )}
                </div>

                {/* Expanded file tree (only for multi-file skills) */}
                {isExpanded && hasMultipleFiles && tree && tree.map((node) => renderFileNode(node, skill.name))}
              </React.Fragment>
            );
          })}
      </div>
    );
  };

  /** Import a skill from a local path */
  const handleImportSkill = useCallback(async () => {
    const trimmed = importPath.trim();
    if (!trimmed) return;

    setImporting(true);
    try {
      const result = await ipcBridge.fs.importSkillWithSymlink.invoke({ skillPath: trimmed });
      if (result.success) {
        Message.success(
          result.msg || t('customize.skillImportSuccess', { defaultValue: 'Skill imported successfully' })
        );
        setShowImportModal(false);
        setImportPath('');
        // Reload skills list
        const freshSkills = await ipcBridge.fs.listAvailableSkills.invoke();
        const loadedSkills = freshSkills ?? [];
        setSkills(loadedSkills);
        // Reload file trees
        const treeEntries = await Promise.all(
          loadedSkills.map(async (skill) => {
            const skillDir = skillDirFromLocation(skill.location);
            try {
              const rawTree = await ipcBridge.fs.getFilesByDir.invoke({ dir: skillDir, root: skillDir });
              const children =
                rawTree && rawTree.length === 1 && rawTree[0].isDir ? (rawTree[0].children ?? []) : (rawTree ?? []);
              return [skill.name, children] as const;
            } catch {
              return [skill.name, []] as const;
            }
          })
        );
        setFileTrees(Object.fromEntries(treeEntries));
        // Select the newly imported skill
        const newSkill = loadedSkills.find((s) => s.name === result.data?.skillName);
        if (newSkill) {
          onFileSelect(newSkill.location, newSkill.name);
        }
      } else {
        Message.error(result.msg || t('customize.skillImportFailed', { defaultValue: 'Failed to import skill' }));
      }
    } catch (error) {
      console.error('[SkillsList] Import skill failed:', error);
      Message.error(t('customize.skillImportError', { defaultValue: 'Error importing skill' }));
    } finally {
      setImporting(false);
    }
  }, [importPath, t, onFileSelect]);

  if (loading) {
    return (
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>{t('customize.skills', { defaultValue: 'Skills' })}</div>
        <div className={styles.listContent}>
          <div className='text-center py-20px text-t-secondary text-13px'>
            {t('common.loading', { defaultValue: 'Loading...' })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeader}>
        <span>{t('customize.skills', { defaultValue: 'Skills' })}</span>
        <button
          className={styles.listHeaderBtn}
          onClick={() => setShowImportModal(true)}
          title={t('customize.importSkill', { defaultValue: 'Import skill' })}
        >
          <Plus theme='outline' size='16' />
        </button>
      </div>
      <div className={styles.listContent}>
        {skills.length === 0 ? (
          <div className='text-center py-20px text-t-secondary text-13px'>
            {t('customize.noSkills', { defaultValue: 'No skills found' })}
          </div>
        ) : (
          <>
            {renderGroup(
              'personal',
              t('customize.personalSkills', { defaultValue: 'Personal skills' }),
              personalSkills
            )}
            {renderGroup('builtin', t('customize.builtinSkills', { defaultValue: 'Built-in skills' }), builtinSkills)}
          </>
        )}
      </div>

      {/* Import skill modal */}
      <Modal
        title={t('customize.importSkill', { defaultValue: 'Import Skill' })}
        visible={showImportModal}
        onCancel={() => {
          setShowImportModal(false);
          setImportPath('');
        }}
        onOk={() => void handleImportSkill()}
        confirmLoading={importing}
        okText={t('customize.import', { defaultValue: 'Import' })}
        unmountOnExit
      >
        <div className='flex flex-col gap-8px'>
          <div className='text-13px text-t-secondary'>
            {t('customize.importSkillDesc', {
              defaultValue: 'Enter the path to a skill directory containing SKILL.md',
            })}
          </div>
          <Input
            placeholder='/path/to/skill'
            value={importPath}
            onChange={setImportPath}
            onPressEnter={() => void handleImportSkill()}
          />
        </div>
      </Modal>
    </div>
  );
};

export default SkillsList;
