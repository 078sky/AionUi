/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow, screen, app, ipcMain, Menu, MenuItem } from 'electron';
import path from 'path';
import { setPetNotifyHook } from '@/common/adapter/main';

let petWindow: BrowserWindow | null = null;
let hitWin: BrowserWindow | null = null;
const PET_SIZE = 320;

// ══════════════════════════════════════════════
// WINDOW CREATION
// ══════════════════════════════════════════════

export function createPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) return;

  const { workArea } = screen.getPrimaryDisplay();
  const startX = workArea.x + workArea.width - PET_SIZE - 20;
  const startY = workArea.y + workArea.height - PET_SIZE - 20;

  // ── Render window (display only, no mouse events) ──
  petWindow = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  petWindow.setIgnoreMouseEvents(true);

  if (process.platform === 'darwin') {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    petWindow.setAlwaysOnTop(true, 'screen-saver');
  }
  if (process.platform === 'win32') {
    petWindow.setAlwaysOnTop(true, 'pop-up-menu');
  }

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void petWindow.loadURL(`${rendererUrl}/pet.html`);
  } else {
    void petWindow.loadFile(path.join(__dirname, '../renderer/pet.html'));
  }

  petWindow.showInactive();

  // ── Hit window (input only, transparent, covers pet body area) ──
  const hitBounds = getHitBounds(startX, startY, PET_SIZE);

  hitWin = new BrowserWindow({
    width: hitBounds.width,
    height: hitBounds.height,
    x: hitBounds.x,
    y: hitBounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/petHit.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // hitWin ALWAYS receives mouse events
  hitWin.setIgnoreMouseEvents(false);

  if (process.platform === 'darwin') {
    hitWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    hitWin.setAlwaysOnTop(true, 'screen-saver');
  }
  if (process.platform === 'win32') {
    hitWin.setAlwaysOnTop(true, 'pop-up-menu');
  }

  if (rendererUrl) {
    void hitWin.loadURL(`${rendererUrl}/pet-hit.html`);
  } else {
    void hitWin.loadFile(path.join(__dirname, '../renderer/pet-hit.html'));
  }

  hitWin.showInactive();

  // Restore dock on macOS
  if (process.platform === 'darwin' && app.dock) {
    void app.dock.show();
  }

  petWindow.on('closed', () => {
    petWindow = null;
  });
  hitWin.on('closed', () => {
    hitWin = null;
  });

  // Register hooks
  setPetNotifyHook(handleBridgeMessage);
  registerHitIPC();

  console.log('[AionUi] Pet + Hit windows created');
}

export function destroyPetWindow(): void {
  setPetNotifyHook(null);
  if (hitWin && !hitWin.isDestroyed()) {
    hitWin.destroy();
    hitWin = null;
  }
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
    petWindow = null;
  }
}

export function setPetState(state: string): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:state-changed', state);
  }
}

// ══════════════════════════════════════════════
// HIT AREA — calculate position over pet body
// ══════════════════════════════════════════════

function getHitBounds(petX: number, petY: number, petSize: number) {
  // Hit area covers center 60% of pet window (body area)
  const margin = Math.round(petSize * 0.2);
  return {
    x: petX + margin,
    y: petY + margin,
    width: petSize - margin * 2,
    height: petSize - margin * 2,
  };
}

function syncHitWin(): void {
  if (!petWindow || petWindow.isDestroyed() || !hitWin || hitWin.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const hit = getHitBounds(bounds.x, bounds.y, bounds.width);
  hitWin.setBounds(hit);
}

// ══════════════════════════════════════════════
// HIT WINDOW IPC — drag, click, context menu
// ══════════════════════════════════════════════

let dragOffset = { x: 0, y: 0 };
let dragInterval: ReturnType<typeof setInterval> | null = null;
let hitIPCRegistered = false;

function registerHitIPC(): void {
  if (hitIPCRegistered) return;
  hitIPCRegistered = true;

  // ── Drag ──
  let stateBeforeDrag = 'idle';

  ipcMain.on('pet:drag-start', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = petWindow.getPosition();
    dragOffset = { x: cursor.x - wx, y: cursor.y - wy };

    stateBeforeDrag = currentPetState;
    changePetState('dragging');

    if (dragInterval) clearInterval(dragInterval);
    dragInterval = setInterval(() => {
      if (!petWindow || petWindow.isDestroyed()) {
        if (dragInterval) {
          clearInterval(dragInterval);
          dragInterval = null;
        }
        return;
      }
      const cur = screen.getCursorScreenPoint();
      const { width, height } = petWindow.getBounds();
      petWindow.setBounds({
        x: cur.x - dragOffset.x,
        y: cur.y - dragOffset.y,
        width,
        height,
      });
      syncHitWin();
    }, 16);
  });

  ipcMain.on('pet:drag-end', () => {
    if (dragInterval) {
      clearInterval(dragInterval);
      dragInterval = null;
    }
    changePetState(stateBeforeDrag);
  });

  // ── Click ──
  ipcMain.on('pet:click', (_event, _side: string) => {
    changePetState('attention', 3000);
  });

  // ── Right-click context menu ──
  ipcMain.on('pet:context-menu', () => {
    const menu = new Menu();

    menu.append(new MenuItem({ label: '🤗 摸一摸', click: () => changePetState('attention', 3000) }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: '🔹 小 (240px)', click: () => resizePet(240) }));
    menu.append(new MenuItem({ label: '🔸 中 (320px)', click: () => resizePet(320) }));
    menu.append(new MenuItem({ label: '🔶 大 (440px)', click: () => resizePet(440) }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: '💤 重置', click: () => changePetState('idle') }));
    menu.append(
      new MenuItem({
        label: '👋 隐藏宠物',
        click: () => {
          petWindow?.hide();
          hitWin?.hide();
        },
      })
    );

    menu.popup();
  });
}

function resizePet(size: number): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const [x, y] = petWindow.getPosition();
  const [w] = petWindow.getSize();
  const newX = x + Math.round((w - size) / 2);
  const newY = y + Math.round((w - size) / 2);
  petWindow.setBounds({ x: newX, y: newY, width: size, height: size });
  syncHitWin();
}

// ══════════════════════════════════════════════
// AI EVENTS — via bridge notify hook
// ══════════════════════════════════════════════

let currentPetState = 'idle';
let autoReturnTimer: ReturnType<typeof setTimeout> | null = null;

const STREAM_CHANNELS = new Set(['chat.response.stream', 'openclaw.response.stream']);

function handleBridgeMessage(name: string, data: unknown): void {
  if (!STREAM_CHANNELS.has(name)) return;
  const msg = data as { type?: string } | undefined;
  if (!msg?.type) return;

  // Map message type to pet state — only queue if state actually changes
  let targetState: string | null = null;
  let autoMs = 0;

  switch (msg.type) {
    case 'thought':
      targetState = 'thinking';
      break;
    case 'content':
      targetState = 'working';
      break;
    case 'finish':
      targetState = 'happy';
      autoMs = 3000;
      break;
    case 'error':
      targetState = 'error';
      autoMs = 5000;
      break;
  }

  if (targetState && targetState !== currentPetState) {
    changePetState(targetState, autoMs);
  }
}

function changePetState(state: string, autoReturnMs?: number): void {
  currentPetState = state;
  // Use setImmediate to not block the bridge emit path
  setImmediate(() => setPetState(state));
  if (autoReturnTimer) {
    clearTimeout(autoReturnTimer);
    autoReturnTimer = null;
  }
  if (autoReturnMs) {
    autoReturnTimer = setTimeout(() => {
      currentPetState = 'idle';
      setPetState('idle');
    }, autoReturnMs);
  }
}
