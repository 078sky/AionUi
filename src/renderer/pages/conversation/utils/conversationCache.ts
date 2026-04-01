/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApiClient } from '@renderer/api/client';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';

export async function refreshConversationCache(api: ApiClient, conversationId: string): Promise<void> {
  const conversation = await api.request('get-conversation', { id: conversationId }).catch((): null => null);
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversationId}`, conversation, false);
}
