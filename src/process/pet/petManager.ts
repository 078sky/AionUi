/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import { PetStateMachine } from './petStateMachine';
import { PetIdleTicker } from './petIdleTicker';
import { PetEventBridge } from './petEventBridge';
import { setPetNotifyHook } from '../../common/adapter/main';
import type { PetSize, PetState } from './petTypes';

let petWindow: BrowserWindow | null = null;
let petHitWindow: BrowserWindow | null = null;
let stateMachine: PetStateMachine | null = null;
let idleTicker: PetIdleTicker | null = null;
let eventBridge: PetEventBridge | null = null;

let currentSize: PetSize = 280;
let dragTimer: ReturnType<typeof setInterval> | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

/**
 * Create pet windows (rendering window + hit detection window)
 */
export function createPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const margin = 20;
  const x = screenWidth - currentSize - margin;
  const y = screenHeight - currentSize - margin;

  // Create rendering window (transparent, always on top, ignores mouse events)
  petWindow = new BrowserWindow({
    width: currentSize,
    height: currentSize,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'petPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Set window level for always-on-top behavior
  if (process.platform === 'darwin') {
    petWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    petWindow.setAlwaysOnTop(true, 'pop-up-menu');
  }

  petWindow.setIgnoreMouseEvents(true);

  // Create hit detection window (body area only, 60% of pet size)
  const hitSize = Math.round(currentSize * 0.6);
  const hitOffset = Math.round(currentSize * 0.2);

  petHitWindow = new BrowserWindow({
    width: hitSize,
    height: hitSize,
    x: x + hitOffset,
    y: y + hitOffset,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'petHitPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform === 'darwin') {
    petHitWindow.setAlwaysOnTop(true, 'screen-saver');
  } else {
    petHitWindow.setAlwaysOnTop(true, 'pop-up-menu');
  }

  petHitWindow.setIgnoreMouseEvents(false);

  // Initialize state machine, idle ticker, and event bridge
  stateMachine = new PetStateMachine();
  idleTicker = new PetIdleTicker(stateMachine);
  eventBridge = new PetEventBridge(stateMachine, idleTicker);

  // Register state change callback → send to renderer via IPC
  stateMachine.onStateChange((state: PetState) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:state-changed', state);
    }
  });

  // Register eye move callback
  idleTicker.onEyeMove((data) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:eye-move', data);
    }
  });

  // Set pet bounds for idle ticker
  idleTicker.setPetBounds(x, y, currentSize, currentSize);

  // Set pet notify hook for bridge events
  setPetNotifyHook((name: string, data: unknown) => {
    if (eventBridge) {
      eventBridge.handleBridgeMessage(name, data);
    }
  });

  // Start idle ticker
  idleTicker.start();

  // Register IPC handlers
  registerIpcHandlers();

  // Load renderer HTML
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];

  if (!app.isPackaged && rendererUrl) {
    // Development mode: use dev server URL
    const petUrl = `${rendererUrl}/pet/pet.html`;
    const petHitUrl = `${rendererUrl}/pet/pet-hit.html`;

    petWindow.loadURL(petUrl).catch((error) => {
      console.error('[Pet] loadURL failed for pet window:', error);
    });

    petHitWindow.loadURL(petHitUrl).catch((error) => {
      console.error('[Pet] loadURL failed for pet-hit window:', error);
    });
  } else {
    // Production mode: use built HTML files
    const petFile = path.join(__dirname, '..', '..', 'renderer', 'pet', 'pet.html');
    const petHitFile = path.join(__dirname, '..', '..', 'renderer', 'pet', 'pet-hit.html');

    petWindow.loadFile(petFile).catch((error) => {
      console.error('[Pet] loadFile failed for pet window:', error);
    });

    petHitWindow.loadFile(petHitFile).catch((error) => {
      console.error('[Pet] loadFile failed for pet-hit window:', error);
    });
  }

  // Clean up on window close
  petWindow.on('closed', () => {
    destroyPetWindow();
  });

  console.log('[Pet] Pet windows created');
}

/**
 * Destroy pet windows and clean up resources
 */
export function destroyPetWindow(): void {
  // Stop drag timer
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }

  // Dispose event bridge
  if (eventBridge) {
    eventBridge.dispose();
    eventBridge = null;
  }

  // Stop idle ticker
  if (idleTicker) {
    idleTicker.stop();
    idleTicker = null;
  }

  // Dispose state machine
  if (stateMachine) {
    stateMachine.dispose();
    stateMachine = null;
  }

  // Clear pet notify hook
  setPetNotifyHook(null);

  // Unregister IPC handlers
  unregisterIpcHandlers();

  // Close windows
  if (petHitWindow && !petHitWindow.isDestroyed()) {
    petHitWindow.destroy();
  }
  petHitWindow = null;

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }
  petWindow = null;

  console.log('[Pet] Pet windows destroyed');
}

/**
 * Show pet windows
 */
export function showPetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
  }
  if (petHitWindow && !petHitWindow.isDestroyed()) {
    petHitWindow.show();
  }
}

/**
 * Hide pet windows
 */
export function hidePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
  if (petHitWindow && !petHitWindow.isDestroyed()) {
    petHitWindow.hide();
  }
}

/**
 * Get event bridge instance for external calls
 */
export function getEventBridge(): PetEventBridge | null {
  return eventBridge;
}

/**
 * Register IPC handlers for pet interactions
 */
function registerIpcHandlers(): void {
  // Drag start
  ipcMain.on('pet:drag-start', () => {
    if (!petWindow || petWindow.isDestroyed() || !petHitWindow || petHitWindow.isDestroyed()) return;

    const cursor = screen.getCursorScreenPoint();
    const windowPos = petWindow.getPosition();
    dragOffsetX = cursor.x - windowPos[0];
    dragOffsetY = cursor.y - windowPos[1];

    if (stateMachine) {
      stateMachine.forceState('dragging');
    }

    // Start 16ms drag interval (60 FPS)
    dragTimer = setInterval(() => {
      if (!petWindow || petWindow.isDestroyed() || !petHitWindow || petHitWindow.isDestroyed()) {
        if (dragTimer) {
          clearInterval(dragTimer);
          dragTimer = null;
        }
        return;
      }

      const cursor = screen.getCursorScreenPoint();
      const newX = cursor.x - dragOffsetX;
      const newY = cursor.y - dragOffsetY;

      petWindow.setPosition(newX, newY, false);

      // Update hit window position (offset by 20%)
      const hitOffset = Math.round(currentSize * 0.2);
      petHitWindow.setPosition(newX + hitOffset, newY + hitOffset, false);

      // Update idle ticker bounds
      if (idleTicker) {
        idleTicker.setPetBounds(newX, newY, currentSize, currentSize);
      }
    }, 16);
  });

  // Drag end
  ipcMain.on('pet:drag-end', () => {
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = null;
    }

    if (stateMachine) {
      stateMachine.forceState('idle');
    }

    if (idleTicker) {
      idleTicker.resetIdle();
    }
  });

  // Click
  ipcMain.on('pet:click', (_event, data: { side: string; count: number }) => {
    if (!stateMachine || !idleTicker) return;

    idleTicker.resetIdle();

    if (data.count >= 3) {
      stateMachine.requestState('error');
    } else if (data.count === 2) {
      const state = data.side === 'left' ? 'poke-left' : 'poke-right';
      stateMachine.requestState(state);
    } else if (data.count === 1) {
      stateMachine.requestState('attention');
    }
  });

  // Context menu
  ipcMain.on('pet:context-menu', () => {
    if (!petHitWindow || petHitWindow.isDestroyed()) return;

    const menu = Menu.buildFromTemplate([
      {
        label: 'Pat',
        click: () => {
          if (stateMachine && idleTicker) {
            idleTicker.resetIdle();
            stateMachine.requestState('happy');
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Size',
        submenu: [
          {
            label: 'Small (200px)',
            type: 'radio',
            checked: currentSize === 200,
            click: () => resizePet(200),
          },
          {
            label: 'Medium (280px)',
            type: 'radio',
            checked: currentSize === 280,
            click: () => resizePet(280),
          },
          {
            label: 'Large (360px)',
            type: 'radio',
            checked: currentSize === 360,
            click: () => resizePet(360),
          },
        ],
      },
      { type: 'separator' },
      {
        label: 'Do Not Disturb',
        type: 'checkbox',
        checked: stateMachine?.getDnd() ?? false,
        click: (menuItem) => {
          if (stateMachine) {
            stateMachine.setDnd(menuItem.checked);
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Reset Position',
        click: () => {
          if (!petWindow || petWindow.isDestroyed() || !petHitWindow || petHitWindow.isDestroyed()) return;

          const primaryDisplay = screen.getPrimaryDisplay();
          const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
          const margin = 20;
          const x = screenWidth - currentSize - margin;
          const y = screenHeight - currentSize - margin;

          petWindow.setPosition(x, y, false);

          const hitOffset = Math.round(currentSize * 0.2);
          petHitWindow.setPosition(x + hitOffset, y + hitOffset, false);

          if (idleTicker) {
            idleTicker.setPetBounds(x, y, currentSize, currentSize);
          }
        },
      },
      {
        label: 'Hide',
        click: () => {
          hidePetWindow();
        },
      },
    ]);

    menu.popup({ window: petHitWindow });
  });
}

/**
 * Unregister IPC handlers
 */
function unregisterIpcHandlers(): void {
  ipcMain.removeAllListeners('pet:drag-start');
  ipcMain.removeAllListeners('pet:drag-end');
  ipcMain.removeAllListeners('pet:click');
  ipcMain.removeAllListeners('pet:context-menu');
}

/**
 * Resize pet windows
 */
function resizePet(size: PetSize): void {
  if (!petWindow || petWindow.isDestroyed() || !petHitWindow || petHitWindow.isDestroyed()) return;

  currentSize = size;

  // Get current position
  const [x, y] = petWindow.getPosition();

  // Resize main window
  petWindow.setSize(size, size, false);

  // Resize and reposition hit window
  const hitSize = Math.round(size * 0.6);
  const hitOffset = Math.round(size * 0.2);
  petHitWindow.setSize(hitSize, hitSize, false);
  petHitWindow.setPosition(x + hitOffset, y + hitOffset, false);

  // Update idle ticker bounds
  if (idleTicker) {
    idleTicker.setPetBounds(x, y, size, size);
  }

  // Notify renderer
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:resize', size);
  }
}
