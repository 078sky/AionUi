/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Right panel for Tools tab — shows detail view for a selected MCP server.
 * Displays server name, enable/disable toggle, transport info,
 * tools list (when active), and configuration.
 *
 * Does NOT manage its own MCP state — receives server data and toggle
 * callback from parent (CustomizePage) for correct state propagation.
 */

import type { IMcpServer } from '@/common/config/storage';
import { Switch, Tag, Tooltip } from '@arco-design/web-react';
import { Toolkit } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../customize.module.css';

interface ToolDetailProps {
  server: IMcpServer;
  /** Toggle server enabled state — managed by parent */
  onToggle: (serverId: string, enabled: boolean) => Promise<void>;
}

/** Format transport type for display */
function formatTransportType(type: string): string {
  switch (type) {
    case 'stdio':
      return 'Standard I/O';
    case 'http':
      return 'HTTP';
    case 'sse':
      return 'Server-Sent Events';
    default:
      return type;
  }
}

/** Pretty-format JSON string, handling invalid JSON gracefully */
function formatJson(jsonStr: string): string {
  try {
    return JSON.stringify(JSON.parse(jsonStr), null, 2);
  } catch {
    return jsonStr;
  }
}

const ToolDetail: React.FC<ToolDetailProps> = ({ server, onToggle }) => {
  const { t } = useTranslation();
  const [toggling, setToggling] = useState(false);

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      setToggling(true);
      try {
        await onToggle(server.id, enabled);
      } finally {
        setToggling(false);
      }
    },
    [onToggle, server.id]
  );

  return (
    <div className={styles.previewPanel}>
      {/* Header with name and toggle switch */}
      <div className={styles.previewHeader}>
        <span className={styles.previewTitle}>{server.name}</span>
        <div className={styles.previewActions}>
          <Switch
            size='small'
            checked={server.enabled}
            loading={toggling}
            onChange={(checked) => void handleToggle(checked)}
          />
        </div>
      </div>

      <div className={styles.previewContent}>
        <div className={styles.toolDetail}>
          {/* Server header */}
          <div className={styles.toolDetailHeader}>
            <div className={styles.toolItemIcon}>
              <Toolkit theme='outline' size='20' />
            </div>
            <div className='flex-1'>
              <div className={styles.toolDetailName}>{server.name}</div>
              {server.description && <div className='text-13px text-t-secondary mt-2px'>{server.description}</div>}
            </div>
            <Tag color={server.enabled ? 'green' : 'gray'} size='small'>
              {server.enabled
                ? t('customize.enabled', { defaultValue: 'Active' })
                : t('customize.disabled', { defaultValue: 'Off' })}
            </Tag>
          </div>

          {/* Tools provided by this MCP server */}
          {server.enabled && server.tools && server.tools.length > 0 && (
            <div className={styles.toolDetailSection}>
              <div className={styles.toolDetailSectionTitle}>
                {t('customize.providedTools', { defaultValue: 'Tools' })} ({server.tools.length})
              </div>
              <div className={styles.toolFunctionList}>
                {server.tools.map((tool, index) => (
                  <div key={index} className={styles.toolFunctionItem}>
                    <div className={styles.toolFunctionName}>{tool.name}</div>
                    {tool.description && (
                      <Tooltip content={tool.description}>
                        <div className={styles.toolFunctionDesc}>{tool.description}</div>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transport info */}
          <div className={styles.toolDetailSection}>
            <div className={styles.toolDetailSectionTitle}>
              {t('customize.transport', { defaultValue: 'Transport' })}
            </div>
            <div className='flex items-center gap-8px mb-8px'>
              <Tag size='small'>{formatTransportType(server.transport.type)}</Tag>
            </div>

            {server.transport.type === 'stdio' && (
              <div className='text-13px text-t-secondary'>
                <div className='flex gap-8px mb-4px'>
                  <span className='text-t-tertiary shrink-0'>
                    {t('customize.command', { defaultValue: 'Command' })}:
                  </span>
                  <code className='text-t-primary bg-fill-2 px-6px py-2px rd-4px'>
                    {server.transport.command} {(server.transport.args ?? []).join(' ')}
                  </code>
                </div>
              </div>
            )}

            {(server.transport.type === 'http' || server.transport.type === 'sse') && (
              <div className='text-13px text-t-secondary'>
                <div className='flex gap-8px mb-4px'>
                  <span className='text-t-tertiary shrink-0'>URL:</span>
                  <code className='text-t-primary bg-fill-2 px-6px py-2px rd-4px break-all'>
                    {server.transport.url ?? '—'}
                  </code>
                </div>
              </div>
            )}
          </div>

          {/* Original JSON config — pretty-printed */}
          {server.originalJson && (
            <div className={styles.toolDetailSection}>
              <div className={styles.toolDetailSectionTitle}>
                {t('customize.configuration', { defaultValue: 'Configuration' })}
              </div>
              <pre className={styles.codeBlock}>{formatJson(server.originalJson)}</pre>
            </div>
          )}

          {/* Metadata */}
          <div className={styles.toolDetailSection}>
            <div className={styles.toolDetailSectionTitle}>{t('customize.metadata', { defaultValue: 'Details' })}</div>
            <div className='text-13px text-t-secondary flex flex-col gap-4px'>
              <div>
                <span className='text-t-tertiary'>ID: </span>
                <span className='text-t-primary'>{server.id}</span>
              </div>
              {server.createdAt && (
                <div>
                  <span className='text-t-tertiary'>{t('customize.created', { defaultValue: 'Created' })}: </span>
                  <span className='text-t-primary'>{new Date(server.createdAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ToolDetail;
