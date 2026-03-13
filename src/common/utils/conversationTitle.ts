/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const stripThinkTagsForTitle = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return content;
  }

  return content
    .replace(/<\s*think\s*>([\s\S]*?)<\s*\/\s*think\s*>/gi, '')
    .replace(/<\s*thinking\s*>([\s\S]*?)<\s*\/\s*thinking\s*>/gi, '')
    .replace(/^[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/i, '')
    .replace(/<\s*\/\s*think(?:ing)?\s*>/gi, '')
    .replace(/<\s*think(?:ing)?\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const hasThinkTagsForTitle = (content: string): boolean => {
  if (!content || typeof content !== 'string') {
    return false;
  }
  return /<\s*\/?\s*think(?:ing)?\s*>/i.test(content);
};

/**
 * Build conversation title using the same first-line + max-length rule as UI.
 */
export const buildConversationTitleFromMessage = (messageContent: string, maxLength = 50): string => {
  const cleanContent = hasThinkTagsForTitle(messageContent) ? stripThinkTagsForTitle(messageContent) : messageContent;
  return cleanContent.split('\n')[0].substring(0, maxLength).trim();
};
