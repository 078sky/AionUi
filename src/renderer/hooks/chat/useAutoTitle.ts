import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '@renderer/api';
import { useConversationTabs } from '@/renderer/pages/conversation/hooks/ConversationTabsContext';
import { deriveAutoTitleFromMessages } from '@/renderer/utils/chat/autoTitle';
import { emitter } from '@/renderer/utils/emitter';

export const useAutoTitle = () => {
  const { t } = useTranslation();
  const api = useApi();
  const { updateTabName } = useConversationTabs();

  const syncTitleFromHistory = useCallback(
    async (conversationId: string, fallbackContent?: string) => {
      const defaultTitle = t('conversation.welcome.newConversation');
      try {
        const conversation = await api.request('get-conversation', { id: conversationId });
        if (!conversation || conversation.name !== defaultTitle) {
          return;
        }

        const messages = await api.request('database.get-conversation-messages', {
          conversation_id: conversationId,
          page: 0,
          pageSize: 1000,
        });
        const newTitle = deriveAutoTitleFromMessages(messages, fallbackContent);
        if (!newTitle) {
          return;
        }

        const success = await api.request('update-conversation', {
          id: conversationId,
          updates: { name: newTitle },
        });
        if (!success) {
          return;
        }

        updateTabName(conversationId, newTitle);
        emitter.emit('chat.history.refresh');
      } catch (error) {
        console.error('Failed to auto-update conversation title:', error);
      }
    },
    [api, t, updateTabName]
  );

  const checkAndUpdateTitle = useCallback(
    async (conversationId: string, messageContent: string) => {
      await syncTitleFromHistory(conversationId, messageContent);
    },
    [syncTitleFromHistory]
  );

  return {
    checkAndUpdateTitle,
    syncTitleFromHistory,
  };
};
