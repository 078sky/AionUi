/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Middle panel for Tools/Connectors tab — shows MCP servers list
 * grouped by connection status, with + button to add new connectors.
 *
 * Receives MCP server data and callbacks from parent (CustomizePage).
 */

import { type IMcpServer, BUILTIN_IMAGE_GEN_ID } from '@/common/config/storage';
import AddMcpServerModal from '@/renderer/pages/settings/components/AddMcpServerModal';
import { Toolkit, Plus } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../customize.module.css';

interface ToolsListProps {
  /** User-configured MCP servers from parent */
  mcpServers: IMcpServer[];
  /** Extension-contributed MCP servers from parent */
  extensionMcpServers: IMcpServer[];
  /** Currently selected MCP server ID */
  selectedServerId: string | null;
  /** Callback when a tool/server is selected */
  onServerSelect: (server: IMcpServer) => void;
  /** Callback to add a single MCP server */
  onAddServer: (server: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>) => void;
  /** Callback to batch import MCP servers */
  onBatchImport: (servers: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
}

/** Filter out the builtin image gen server (hidden from user) */
const isVisibleServer = (server: IMcpServer) => !(server.builtin === true && server.id === BUILTIN_IMAGE_GEN_ID);

const ToolsList: React.FC<ToolsListProps> = ({
  mcpServers,
  extensionMcpServers,
  selectedServerId,
  onServerSelect,
  onAddServer,
  onBatchImport,
}) => {
  const { t } = useTranslation();
  const autoSelectedRef = useRef(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const visibleServers = useMemo(() => mcpServers.filter(isVisibleServer), [mcpServers]);

  // Group user servers by enabled status
  const enabledServers = useMemo(() => visibleServers.filter((s) => s.enabled), [visibleServers]);
  const disabledServers = useMemo(() => visibleServers.filter((s) => !s.enabled), [visibleServers]);

  // Auto-select first server on initial load
  useEffect(() => {
    if (autoSelectedRef.current || selectedServerId) return;
    const firstServer = enabledServers[0] ?? disabledServers[0] ?? extensionMcpServers[0];
    if (firstServer) {
      autoSelectedRef.current = true;
      onServerSelect(firstServer);
    }
  }, [enabledServers, disabledServers, extensionMcpServers, selectedServerId, onServerSelect]);

  /** Handle submit from AddMcpServerModal */
  const handleAddSubmit = useCallback(
    (serverData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>) => {
      onAddServer(serverData);
      setShowAddModal(false);
    },
    [onAddServer]
  );

  /** Handle batch import from AddMcpServerModal */
  const handleBatchSubmit = useCallback(
    (serversData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      onBatchImport(serversData);
      setShowAddModal(false);
    },
    [onBatchImport]
  );

  const renderServer = (server: IMcpServer, isReadOnly: boolean = false) => {
    const isSelected = selectedServerId === server.id;

    return (
      <div
        key={server.id}
        className={classNames(styles.toolItem, isSelected && styles.toolItemActive)}
        onClick={() => onServerSelect(server)}
      >
        <div className={styles.toolItemIcon}>
          <Toolkit theme='outline' size='16' />
        </div>
        <div className={styles.toolItemInfo}>
          <div className={styles.toolItemName}>{server.name}</div>
          {server.description && <div className={styles.toolItemDesc}>{server.description}</div>}
        </div>
        <span className={classNames(styles.toolItemBadge, server.enabled && styles.toolItemEnabled)}>
          {server.enabled
            ? t('customize.enabled', { defaultValue: 'Active' })
            : t('customize.disabled', { defaultValue: 'Off' })}
        </span>
        {isReadOnly && (
          <span className={styles.toolItemBadge}>{t('customize.extension', { defaultValue: 'Extension' })}</span>
        )}
      </div>
    );
  };

  const hasAny = visibleServers.length > 0 || extensionMcpServers.length > 0;

  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeader}>
        <span>{t('customize.connectors', { defaultValue: 'Connectors' })}</span>
        <button
          className={styles.listHeaderBtn}
          onClick={() => setShowAddModal(true)}
          title={t('customize.addConnector', { defaultValue: 'Add connector' })}
        >
          <Plus theme='outline' size='16' />
        </button>
      </div>
      <div className={styles.listContent}>
        {!hasAny ? (
          <div className='text-center py-20px text-t-secondary text-13px'>
            {t('customize.noTools', { defaultValue: 'No connectors configured' })}
          </div>
        ) : (
          <>
            {enabledServers.length > 0 && (
              <div>
                <div className={styles.groupHeader}>
                  <span>{t('customize.activeConnectors', { defaultValue: 'Active' })}</span>
                </div>
                {enabledServers.map((s) => renderServer(s))}
              </div>
            )}

            {disabledServers.length > 0 && (
              <div>
                <div className={styles.groupHeader}>
                  <span>{t('customize.configuredConnectors', { defaultValue: 'Configured' })}</span>
                </div>
                {disabledServers.map((s) => renderServer(s))}
              </div>
            )}

            {extensionMcpServers.length > 0 && (
              <div>
                <div className={styles.groupHeader}>
                  <span>{t('customize.extensionConnectors', { defaultValue: 'Extensions' })}</span>
                </div>
                {extensionMcpServers.map((s) => renderServer(s, true))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add MCP server modal — reuses the existing settings modal */}
      <AddMcpServerModal
        visible={showAddModal}
        onCancel={() => setShowAddModal(false)}
        onSubmit={handleAddSubmit}
        onBatchImport={handleBatchSubmit}
      />
    </div>
  );
};

export default ToolsList;
