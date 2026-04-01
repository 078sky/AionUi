import { loadPersistedStates, savePersistedStates } from '@process/extensions/lifecycle/statePersistence';
import type { HubExtensionStatus } from '@/common/types/hub';
import { extensionEventBus } from '@process/extensions/lifecycle/ExtensionEventBus';
import { ipcBridge } from '@/common';

/**
 * HubStateManager
 *
 * Manages transient in-memory states (installing/uninstalling) and interacts with
 * the persistent state store to track install errors. Also triggers IPC events to renderer.
 */
class HubStateManagerImpl {
  // Store transient statuses during active installation or uninstallation
  private transientStates = new Map<string, HubExtensionStatus>();

  public getTransientState(name: string): HubExtensionStatus | undefined {
    return this.transientStates.get(name);
  }

  public setTransientState(name: string, status: HubExtensionStatus, error?: string) {
    if (status === 'installing' || status === 'uninstalling') {
      this.transientStates.set(name, status);
    } else {
      // Clear transient state when reaching a final state
      this.transientStates.delete(name);
    }

    // Sync to persistent store if it's an error state
    if (status === 'install_failed' && error) {
      this.setPersistentInstallError(name, error);
    } else if (status === 'installed' || status === 'installing') {
      this.clearPersistentInstallError(name);
    }

    // Broadcast state change to renderer
    ipcBridge.hub.onStateChanged.emit({ name, status, error });
  }

  public getPersistentInstallError(name: string): string | undefined {
    const states = loadPersistedStates();
    return states.get(name)?.installError;
  }

  private setPersistentInstallError(name: string, error: string) {
    const states = loadPersistedStates();
    const extState = states.get(name) || { enabled: true };

    extState.installError = error;
    states.set(name, extState);

    savePersistedStates(states);
  }

  private clearPersistentInstallError(name: string) {
    const states = loadPersistedStates();
    const extState = states.get(name);

    if (extState && extState.installError) {
      extState.installError = undefined;
      states.set(name, extState);
      savePersistedStates(states);
    }
  }
}

export const hubStateManager = new HubStateManagerImpl();
