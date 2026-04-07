/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Right panel for Skills tab — renders file content preview.
 * Supports markdown rendering for .md files and code display for others.
 * Editing is supported for custom (non-builtin) skill files.
 */

import { ipcBridge } from '@/common';
import MarkdownView from '@/renderer/components/Markdown';
import { Button, Message } from '@arco-design/web-react';
import { Copy, Edit, PreviewClose, Save } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../customize.module.css';

interface SkillPreviewProps {
  /** Absolute path to the file being previewed */
  filePath: string;
  /** Name of the parent skill (for display) */
  skillName: string;
}

/** Extract the file extension from a path */
function getFileExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/** Extract the filename from a full path */
function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/** Determine if a file is markdown based on extension */
function isMarkdownFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ext === 'md' || ext === 'markdown';
}

const SkillPreview: React.FC<SkillPreviewProps> = ({ filePath, skillName }) => {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fileName = getFileName(filePath);
  const isMarkdown = isMarkdownFile(filePath);

  // Load file content when filePath changes
  useEffect(() => {
    setIsEditing(false);
    setError(null);

    const load = async () => {
      setLoading(true);
      try {
        const result = await ipcBridge.fs.readFile.invoke({ path: filePath });
        if (result === null || result === undefined) {
          setError(t('customize.fileNotFound', { defaultValue: 'File not found' }));
          setContent('');
        } else {
          setContent(result);
        }
      } catch (err) {
        console.error('[SkillPreview] Failed to read file:', err);
        setError(t('customize.fileReadError', { defaultValue: 'Failed to read file' }));
        setContent('');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [filePath, t]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      Message.success(t('common.copied', { defaultValue: 'Copied!' }));
    } catch {
      Message.error(t('common.copyFailed', { defaultValue: 'Failed to copy' }));
    }
  }, [content, t]);

  const handleStartEdit = () => {
    setEditContent(content);
    setIsEditing(true);
    // Focus textarea after render
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const success = await ipcBridge.fs.writeFile.invoke({ path: filePath, data: editContent });
      if (success) {
        setContent(editContent);
        setIsEditing(false);
        Message.success(t('common.saved', { defaultValue: 'Saved!' }));
      } else {
        Message.error(t('customize.saveFailed', { defaultValue: 'Failed to save file' }));
      }
    } catch (err) {
      console.error('[SkillPreview] Failed to save file:', err);
      Message.error(t('customize.saveFailed', { defaultValue: 'Failed to save file' }));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.previewPanel}>
        <div className={styles.previewHeader}>
          <span className={styles.previewTitle}>{fileName}</span>
        </div>
        <div className={styles.previewEmpty}>{t('common.loading', { defaultValue: 'Loading...' })}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.previewPanel}>
        <div className={styles.previewHeader}>
          <span className={styles.previewTitle}>{fileName}</span>
        </div>
        <div className={styles.previewEmpty}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.previewPanel}>
      {/* Header with filename and action buttons */}
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>{fileName}</span>
        <div className={styles.previewActions}>
          {isEditing ? (
            <>
              <Button
                type='text'
                size='small'
                icon={<PreviewClose theme='outline' size='14' />}
                onClick={handleCancelEdit}
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type='primary'
                size='small'
                icon={<Save theme='outline' size='14' />}
                loading={isSaving}
                onClick={() => void handleSave()}
              >
                {t('common.save', { defaultValue: 'Save' })}
              </Button>
            </>
          ) : (
            <>
              <Button
                type='text'
                size='mini'
                icon={<Copy theme='outline' size='14' />}
                onClick={() => void handleCopy()}
              />
              <Button type='text' size='mini' icon={<Edit theme='outline' size='14' />} onClick={handleStartEdit} />
            </>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className={styles.previewContent}>
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className={styles.editTextarea}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            spellCheck={false}
          />
        ) : isMarkdown ? (
          <div className={styles.markdownPreview}>
            <MarkdownView>{content}</MarkdownView>
          </div>
        ) : (
          <pre className={styles.codePreview}>{content}</pre>
        )}
      </div>
    </div>
  );
};

export default SkillPreview;
