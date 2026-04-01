/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0

 */

import { useApi } from '@renderer/api';
import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Hook to listen for notification click events from main process.
 * Navigates to the corresponding conversation page when a notification is clicked.
 */
export const useNotificationClick = () => {
  const api = useApi();
  const navigate = useNavigate();

  const handler = useCallback(
    (payload: { conversationId?: string }) => {
      console.log('[useNotificationClick] Received notification click:', payload);
      if (payload.conversationId) {
        // Navigate to the conversation page / 导航到会话页面
        console.log('[useNotificationClick] Navigating to conversation:', payload.conversationId);
        void navigate(`/conversation/${payload.conversationId}`);
      } else {
        console.warn('[useNotificationClick] No conversationId in payload');
      }
    },
    [navigate]
  );

  useEffect(() => {
    console.log('[useNotificationClick] Registering notification click handler');
    return api.on('notification.clicked', handler);
  }, [handler]);
};
