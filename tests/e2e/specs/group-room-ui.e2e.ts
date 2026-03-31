/**
 * Group Room UI interaction E2E tests.
 *
 * These tests only use real user actions: click, type, and wait for visible UI.
 * No bridge calls, no direct state mutation.
 */
import { test, expect } from '../fixtures';
import { waitForSettle } from '../helpers';
import type { Page } from '@playwright/test';

async function openCreateGroupRoomModal(page: Page) {
  await waitForSettle(page, 3000);
  const modal = page.locator('[data-group-room-create-modal="true"]').first();
  if (await modal.isVisible().catch(() => false)) {
    return;
  }
  await page.locator('[data-group-room-trigger="true"]').click();
  await expect(modal).toBeVisible({ timeout: 5000 });
}

function getNameInput(page: Page) {
  return page.locator('[data-group-room-name-input="true"] input, input[data-group-room-name-input="true"]').first();
}

async function createGroupRoomViaUi(page: Page, roomName: string): Promise<void> {
  await openCreateGroupRoomModal(page);
  await getNameInput(page).fill(roomName);

  const firstAgent = page.locator('[data-group-room-agent-pill="true"][data-agent-backend="claude"]').first();
  await expect
    .poll(async () => await page.locator('[data-group-room-agent-pill="true"][data-agent-backend="claude"]').count(), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await expect(firstAgent).toBeVisible({ timeout: 30_000 });
  await firstAgent.click();

  await page.locator('[data-group-room-confirm="true"]').click();

  await expect(page.locator('[data-group-room-page="true"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-group-room-title="true"]')).toHaveText(roomName);
}

async function sendMainMessage(page: Page, content: string): Promise<void> {
  await page.locator('[data-group-room-input="true"]').fill(content);
  await page.locator('[data-group-room-send="true"]').click();
}

async function waitForScenarioFinished(page: Page): Promise<void> {
  await expect
    .poll(async () => await page.locator('[data-group-room-status]').getAttribute('data-group-room-status'), {
      timeout: 120_000,
    })
    .toBe('idle');
  await expect(page.getByText(/最终结论/)).toBeVisible({
    timeout: 120_000,
  });
}

test.describe('Group room real UI flow', () => {
  test('点击群组入口能打开创建弹窗', async ({ page }) => {
    await openCreateGroupRoomModal(page);

    await expect(getNameInput(page)).toBeVisible();
    await expect(page.locator('[data-group-room-confirm="true"]')).toBeVisible();
  });

  test('Case 11-19: 主Agent协调子Agent的真实群组交互流程', async ({ page }) => {
    test.setTimeout(180_000);

    const roomName = `E2E Orchestrated Group ${Date.now()}`;
    await createGroupRoomViaUi(page, roomName);

    // Case 11-13: create room, show group item in sider, and enter detail page
    const groupRow = page.locator('[data-conversation-type="group-room"]').filter({ hasText: roomName }).first();
    await expect(groupRow).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-group-room-page="true"]')).toBeVisible();
    await expect(page.locator('[data-group-room-title="true"]')).toHaveText(roomName);
    await expect(page.locator('[data-group-room-member-panel="true"]')).toBeVisible();

    await expect(page.locator('[data-group-room-tab="sub"]')).toHaveCount(0);

    await sendMainMessage(
      page,
      [
        '请以真实 Claude 多 Agent 协作模式处理这个任务。',
        '要求：第一轮必须创建两个 claude 子 Agent，名称固定为 Planner 和 Reviewer。',
        'Planner 先给出方案，Reviewer 必须专门检查异常处理、回滚策略、重试机制。',
        '如果 Reviewer 发现缺口，第二轮必须继续返工，而不是直接结束。',
        '完成后请输出以“最终结论：”开头的中文总结。',
        '任务主题：设计一个包含异常处理、回滚与重试策略的执行方案。',
      ].join('\n')
    );

    // Case 14: main panel shows host-user dialogue and thought process in realtime
    await expect(page.getByText(/真实 Claude 多 Agent 协作模式/)).toBeVisible();
    await expect(page.locator('[data-group-room-message-kind="thinking"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-group-room-message-kind="dispatch"]').first()).toBeVisible({ timeout: 60_000 });

    // Case 15: host dynamically creates sub-agents and shows tabs
    await expect(page.locator('[data-group-room-tab="sub"]').filter({ hasText: 'Planner' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-group-room-tab="sub"]').filter({ hasText: 'Reviewer' })).toBeVisible({
      timeout: 60_000,
    });

    // Case 17: sending user input triggers agent creation/coordination
    await expect(page.locator('[data-group-room-member="true"]').filter({ hasText: 'Planner' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-group-room-member="true"]').filter({ hasText: 'Reviewer' })).toBeVisible({
      timeout: 60_000,
    });

    // Case 16: click sub-agent tab and inspect sub-host dialogue
    await page.locator('[data-group-room-tab="sub"]').filter({ hasText: 'Planner' }).click();
    await expect(
      page.locator('.arco-tabs-content-item-active [data-group-room-message-kind="thinking"]').first()
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.locator('.arco-tabs-content-item-active [data-group-room-message-kind="report"]').first()
    ).toBeVisible({
      timeout: 60_000,
    });

    // Case 18: sub-agent tab is read-only
    const activePane = page.locator('.arco-tabs-content-item-active');
    await expect(activePane.locator('[data-group-room-sendbox="true"]')).toHaveCount(0);

    // Back to main panel for coordination view
    await page.locator('[data-group-room-tab="main"]').click();

    // Case 14/19: final host reply visible after realtime coordination completes
    await waitForScenarioFinished(page);
    await expect(page.locator('[data-group-room-message-kind="report"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
