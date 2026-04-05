import type { TChatConversation } from '@/common/config/storage';
import type { AcpBackendAll } from '@/common/types/acpTypes';

export const resolveConversationBackend = (conversation?: TChatConversation): AcpBackendAll | undefined => {
  if (!conversation) {
    return undefined;
  }

  switch (conversation.type) {
    case 'acp':
      return conversation.extra?.backend || 'claude';
    case 'aionrs':
      return 'aionrs';
    case 'codex':
      return 'codex';
    case 'openclaw-gateway':
      return 'openclaw-gateway';
    case 'nanobot':
      return 'nanobot';
    case 'remote':
      return 'remote';
    default:
      return undefined;
  }
};
