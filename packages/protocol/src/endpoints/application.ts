// Application endpoint types - extracted from ipcBridge.ts

export type ICdpStatus = {
  /** Whether CDP is currently enabled */
  enabled: boolean
  /** Current CDP port (null if disabled or not started) */
  port: number | null
  /** Whether CDP was enabled at startup (requires restart to change) */
  startupEnabled: boolean
  /** All active CDP instances from registry */
  instances: Array<{
    pid: number
    port: number
    cwd: string
    startTime: number
  }>
  /** Whether CDP is enabled in the persisted config file (may differ from runtime) */
  configEnabled: boolean
  /** Whether the app is running in development mode */
  isDevMode: boolean
}

export type ICdpConfig = {
  /** Whether CDP is enabled */
  enabled?: boolean
  /** Preferred port number */
  port?: number
}
