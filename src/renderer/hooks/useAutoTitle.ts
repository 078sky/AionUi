import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { buildConversationTitleFromMessage } from '@/common/utils/conversationTitle';
import { useConversationTabs } from '@/renderer/pages/conversation/context/ConversationTabsContext';
import { emitter } from '@/renderer/utils/emitter';

export const useAutoTitle = () => {
  const { t } = useTranslation();
  const { updateTabName } = useConversationTabs();

  const checkAndUpdateTitle = useCallback(
    async (conversationId: string, messageContent: string) => {
      const defaultTitle = t('conversation.welcome.newConversation');
      try {
        const conversation = await ipcBridge.conversation.get.invoke({ id: conversationId });
        // Only update if current name matches the default "New Chat" name
        if (conversation && conversation.name === defaultTitle) {
          const newTitle = buildConversationTitleFromMessage(messageContent);
          if (!newTitle) return; // Don't update if empty

          await ipcBridge.conversation.update.invoke({
            id: conversationId,
            updates: { name: newTitle },
          });

          updateTabName(conversationId, newTitle);
          emitter.emit('chat.history.refresh');
        }
      } catch (error) {
        console.error('Failed to auto-update conversation title:', error);
      }
    },
    [t, updateTabName]
  );

  return { checkAndUpdateTitle };
};
