// WebUI endpoint types - extracted from ipcBridge.ts

export type IWebUIStatus = {
  running: boolean
  port: number
  allowRemote: boolean
  localUrl: string
  networkUrl?: string
  lanIP?: string
  adminUsername: string
  initialPassword?: string
}
