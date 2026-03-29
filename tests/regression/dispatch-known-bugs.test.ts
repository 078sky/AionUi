/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(__dirname, '../../src');

/**
 * Regression tests for dispatch system known bugs.
 * These verify source code patterns to prevent re-introduction of fixed bugs.
 */
describe('Dispatch Known Bugs Regression', () => {
  // REG-001: dispatchBridge filters children by extra.dispatchSessionType === 'dispatch_child',
  //          NOT conv.type === 'dispatch'
  it('REG-001: dispatchBridge uses extra.dispatchSessionType to identify child conversations', () => {
    const bridgeFile = path.join(SRC_ROOT, 'process/bridge/dispatchBridge.ts');
    const content = fs.readFileSync(bridgeFile, 'utf-8');

    // Must filter by dispatchSessionType === 'dispatch_child'
    expect(content).toContain("dispatchSessionType === 'dispatch_child'");

    // The filter must check extra field, not conv.type for children
    // Extract the children filter logic block
    const childrenFilterMatch = content.match(
      /const children = allConversations[\s\S]*?\.filter\(([\s\S]*?)\)\s*\.map/
    );
    expect(childrenFilterMatch).not.toBeNull();

    // The filter should reference dispatchSessionType, not check conv.type === 'dispatch_child'
    const filterBlock = childrenFilterMatch![1];
    expect(filterBlock).toContain('dispatchSessionType');
    expect(filterBlock).not.toMatch(/conv\.type\s*===\s*['"]dispatch_child['"]/);
  });

  // REG-002: useConversations dispatchChildCounts uses extra.dispatchSessionType
  it('REG-002: useConversations counts dispatch children via extra.dispatchSessionType', () => {
    const hooksFile = path.join(SRC_ROOT, 'renderer/pages/conversation/GroupedHistory/hooks/useConversations.ts');
    const content = fs.readFileSync(hooksFile, 'utf-8');

    // Must use extra.dispatchSessionType to count children
    expect(content).toContain("dispatchSessionType === 'dispatch_child'");
    expect(content).toContain('parentSessionId');

    // Must NOT use conv.type to identify children
    expect(content).not.toMatch(/conv\.type\s*===\s*['"]dispatch_child['"]/);
  });

  // REG-003: groupingHelpers filters dispatch_child by extra field (FIXED — no longer uses conv.type guard)
  it('REG-003: groupingHelpers filters dispatch_child via extra.dispatchSessionType without type guard', () => {
    const helpersFile = path.join(SRC_ROOT, 'renderer/pages/conversation/GroupedHistory/utils/groupingHelpers.ts');
    const content = fs.readFileSync(helpersFile, 'utf-8');

    // The buildGroupedHistory function must filter dispatch_child from sidebar
    expect(content).toContain("dispatchSessionType !== 'dispatch_child'");

    // It checks the extra field, not a separate type value
    expect(content).toContain('extra?.dispatchSessionType');

    // Must NOT gate the filter behind a conv.type === 'dispatch' check (the old bug)
    const filterBlock = content.match(/const visibleConversations[\s\S]*?\.filter\(([\s\S]*?)\)\s*;/);
    expect(filterBlock).not.toBeNull();
    expect(filterBlock![1]).not.toMatch(/conv\.type\s*===\s*['"]dispatch['"]/);
  });

  // REG-004: Channels sidebar section visible even with 0 conversations (S1: renamed to Channels)
  it('REG-004: sidebar always renders Group Chat section header regardless of dispatch count', () => {
    const indexFile = path.join(SRC_ROOT, 'renderer/pages/conversation/GroupedHistory/index.tsx');
    const content = fs.readFileSync(indexFile, 'utf-8');

    // S1 renamed the section key from groupChatSection to channelsSection.
    // The section header is rendered unconditionally (not gated by dispatchConversations.length > 0).
    const sectionHeaderIndex = content.indexOf('dispatch.sidebar.channelsSection');
    const conditionalRenderIndex = content.indexOf('dispatchConversations.length > 0');

    expect(sectionHeaderIndex).toBeGreaterThan(-1);
    expect(conditionalRenderIndex).toBeGreaterThan(-1);

    // The section header must appear BEFORE the conditional children render
    expect(sectionHeaderIndex).toBeLessThan(conditionalRenderIndex);

    // Stronger check: verify the section header is NOT inside a block gated by
    // dispatchConversations.length. The header lives in a `!collapsed && (` wrapper,
    // while the list is in a separate `dispatchConversations.length > 0 && (` block.
    // Extract the JSX between the outer <div> that contains the section header and
    // verify the header is a sibling of, not nested inside, the length check.
    const sectionBlock = content.slice(
      content.lastIndexOf('<div', sectionHeaderIndex),
      content.indexOf('\n', conditionalRenderIndex + 50)
    );
    // The section header line should NOT be inside a dispatchConversations.length > 0 guard
    const headerLine = sectionBlock.indexOf('dispatch.sidebar.channelsSection');
    const lengthGuardLine = sectionBlock.indexOf('dispatchConversations.length > 0');
    // Find the opening brace/paren of the length guard — the header must be before it
    expect(headerLine).toBeLessThan(lengthGuardLine);

    // Verify the section header and length check are at different JSX nesting levels
    // by checking they are in separate `{...&&` blocks
    const beforeHeader = content.slice(Math.max(0, sectionHeaderIndex - 200), sectionHeaderIndex);
    // Header is inside `!collapsed && (` — NOT inside a `length > 0` guard
    expect(beforeHeader).toContain('!collapsed');
    expect(beforeHeader).not.toContain('dispatchConversations.length');
  });

  // REG-005: dispatch.json has no double-nesting wrapper key
  it('REG-005: dispatch.json files have no redundant top-level wrapper matching module name', () => {
    const localesDir = path.join(SRC_ROOT, 'renderer/services/i18n/locales');
    const languages = fs.readdirSync(localesDir).filter((d) => {
      return fs.statSync(path.join(localesDir, d)).isDirectory();
    });

    for (const lang of languages) {
      const dispatchFile = path.join(localesDir, lang, 'dispatch.json');
      if (!fs.existsSync(dispatchFile)) continue;

      const content = JSON.parse(fs.readFileSync(dispatchFile, 'utf-8'));
      const keys = Object.keys(content);

      // Should not have a single key "dispatch" wrapping everything
      expect(keys.length === 1 && keys[0] === 'dispatch').toBe(false);
    }
  });
});
