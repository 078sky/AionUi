/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CustomizePage — three-panel layout for browsing Skills and Tools.
 *
 * Layout: [SubNav | List | Preview]
 * - SubNav: Skills / Tools tab switcher
 * - List: Grouped items with file trees (skills) or server list (tools)
 * - Preview: File content viewer or tool detail
 *
 * MCP server state is lifted here so ToolsList badge and ToolDetail toggle
 * stay in sync through a single shared `useMcpServers()` instance.
 */

import type { IMcpServer } from '@/common/config/storage';
import {
  useMcpServers,
  useMcpOperations,
  useMcpServerCRUD,
  useMcpAgentStatus,
  useMcpConnection,
  useMcpOAuth,
} from '@/renderer/hooks/mcp';
import { Message } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import CustomizeSubNav from './CustomizeSubNav';
import styles from './customize.module.css';

// Lazy load tab panels to avoid upfront bundle cost
const SkillsList = React.lazy(() => import('./skills/SkillsList'));
const SkillPreview = React.lazy(() => import('./skills/SkillPreview'));
const ToolsList = React.lazy(() => import('./tools/ToolsList'));
const ToolDetail = React.lazy(() => import('./tools/ToolDetail'));

type CustomizeTab = 'skills' | 'tools';

const CustomizePage: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const activeTab: CustomizeTab = tab === 'tools' ? 'tools' : 'skills';

  // Skills state: which file is selected for preview
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedSkillName, setSelectedSkillName] = useState<string>('');

  // Tools state: which MCP server is selected
  const [selectedServer, setSelectedServer] = useState<IMcpServer | null>(null);

  // Shared MCP state — single source of truth for both ToolsList and ToolDetail
  const message = Message;
  const { mcpServers, extensionMcpServers, saveMcpServers } = useMcpServers();
  const { setAgentInstallStatus, checkSingleServerInstallStatus } = useMcpAgentStatus();
  const { syncMcpToAgents, removeMcpFromAgents } = useMcpOperations(mcpServers, message);
  const { handleToggleMcpServer, handleAddMcpServer, handleBatchImportMcpServers } = useMcpServerCRUD(
    mcpServers,
    saveMcpServers,
    syncMcpToAgents,
    removeMcpFromAgents,
    checkSingleServerInstallStatus,
    setAgentInstallStatus
  );
  const { handleTestMcpConnection } = useMcpConnection(mcpServers, saveMcpServers, message);
  const { checkOAuthStatus } = useMcpOAuth();

  /** Add a single MCP server, test connection, and sync to agents */
  const wrappedHandleAddMcpServer = useCallback(
    async (serverData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>) => {
      const addedServer = await handleAddMcpServer(serverData);
      if (addedServer) {
        void handleTestMcpConnection(addedServer);
        if (addedServer.transport.type === 'http' || addedServer.transport.type === 'sse') {
          void checkOAuthStatus(addedServer);
        }
        if (addedServer.enabled) {
          void syncMcpToAgents(addedServer, true);
        }
        // Auto-select the newly added server
        setSelectedServer(addedServer);
      }
    },
    [handleAddMcpServer, handleTestMcpConnection, checkOAuthStatus, syncMcpToAgents]
  );

  /** Batch import MCP servers */
  const wrappedHandleBatchImport = useCallback(
    async (serversData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      await handleBatchImportMcpServers(serversData);
    },
    [handleBatchImportMcpServers]
  );

  const handleFileSelect = (filePath: string, skillName: string) => {
    setSelectedFilePath(filePath);
    setSelectedSkillName(skillName);
  };

  const handleServerSelect = (server: IMcpServer) => {
    setSelectedServer(server);
  };

  /** Toggle server and update both the list and the detail panel */
  const handleToggle = useCallback(
    async (serverId: string, enabled: boolean) => {
      await handleToggleMcpServer(serverId, enabled);
      // Update the selected server snapshot so detail panel reflects the change
      setSelectedServer((prev) => (prev?.id === serverId ? { ...prev, enabled } : prev));
    },
    [handleToggleMcpServer]
  );

  // Keep selectedServer in sync with mcpServers list (e.g. after toggle)
  const currentSelectedServer = selectedServer
    ? (mcpServers.find((s) => s.id === selectedServer.id) ?? selectedServer)
    : null;

  return (
    <div className={styles.container}>
      {/* Panel 1: Sub-navigation */}
      <CustomizeSubNav activeTab={activeTab} />

      {/* Panel 2 + 3: List + Preview */}
      <React.Suspense fallback={<div className='flex-1' />}>
        {activeTab === 'skills' ? (
          <>
            <SkillsList selectedFilePath={selectedFilePath} onFileSelect={handleFileSelect} />
            {selectedFilePath ? (
              <SkillPreview filePath={selectedFilePath} skillName={selectedSkillName} />
            ) : (
              <div className={styles.previewEmpty}>Select a file to preview</div>
            )}
          </>
        ) : (
          <>
            <ToolsList
              mcpServers={mcpServers}
              extensionMcpServers={extensionMcpServers}
              selectedServerId={currentSelectedServer?.id ?? null}
              onServerSelect={handleServerSelect}
              onAddServer={wrappedHandleAddMcpServer}
              onBatchImport={wrappedHandleBatchImport}
            />
            {currentSelectedServer ? (
              <ToolDetail server={currentSelectedServer} onToggle={handleToggle} />
            ) : (
              <div className={styles.previewEmpty}>Select a connector to view details</div>
            )}
          </>
        )}
      </React.Suspense>
    </div>
  );
};

export default CustomizePage;
