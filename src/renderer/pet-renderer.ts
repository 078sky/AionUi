/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

declare global {
  interface Window {
    petAPI: {
      onStateChange: (cb: (state: string) => void) => void;
      dragStart: () => void;
      dragEnd: () => void;
    };
  }
}

const petObj = document.getElementById('pet') as HTMLObjectElement;

// State changes from main process
window.petAPI.onStateChange((state: string) => {
  petObj.data = `./pet-states/${state}.svg`;
});
