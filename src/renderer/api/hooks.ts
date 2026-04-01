import { createContext, useContext } from 'react';
import type { ApiClient } from './client';

const ApiClientContext = createContext<ApiClient | null>(null);

export const ApiClientProvider = ApiClientContext.Provider;

export function useApi(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApi must be used within an ApiClientProvider');
  }
  return client;
}

// Singleton reference for non-React code (services, utils).
// Set once by the app bootstrap after creating the ApiClient instance.
let singletonClient: ApiClient | null = null;

/** Register the ApiClient singleton for non-React code. Call once at app init. */
export function setApiClient(client: ApiClient): void {
  singletonClient = client;
}

/**
 * Get the ApiClient singleton outside of React components/hooks.
 * Use `useApi()` inside React — this is only for plain utility functions.
 */
export function getApiClient(): ApiClient {
  if (!singletonClient) {
    throw new Error('ApiClient not initialized. Call setApiClient() at app startup.');
  }
  return singletonClient;
}
