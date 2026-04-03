/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

declare global {
  interface Window {
    petHitAPI: {
      dragStart: () => void;
      dragEnd: () => void;
      click: (side: string) => void;
      contextMenu: () => void;
    };
  }
}

let isDragging = false;

document.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    // Right-click → context menu
    window.petHitAPI.contextMenu();
    return;
  }
  isDragging = true;
  window.petHitAPI.dragStart();
});

document.addEventListener('mouseup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  window.petHitAPI.dragEnd();

  // If mouse barely moved, treat as click
  const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
  window.petHitAPI.click(side);
});

// Prevent default context menu
document.addEventListener('contextmenu', (e) => e.preventDefault());
