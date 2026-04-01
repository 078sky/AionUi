// Extension system endpoint types - extracted from ipcBridge.ts

export type IExtensionInfo = {
  name: string
  displayName: string
  version: string
  description?: string
  source: string
  directory: string
  /** Whether the extension is currently enabled */
  enabled: boolean
  /** Overall permission risk level */
  riskLevel: 'safe' | 'moderate' | 'dangerous'
  /** Whether the extension has lifecycle hooks */
  hasLifecycle: boolean
}

/** Permission summary for extension management UI (Figma-inspired) */
export type IExtensionPermissionSummary = {
  name: string
  description: string
  level: 'safe' | 'moderate' | 'dangerous'
  granted: boolean
}

/** Settings tab contributed by an extension, consumed by settings UI */
export type IExtensionSettingsTab = {
  id: string
  name: string
  icon?: string
  /** aion-asset:// local page or external https:// URL */
  entryUrl: string
  /** Position anchor relative to a built-in or other extension tab */
  position?: { anchor: string; placement: 'before' | 'after' }
  /** Fallback numeric order when multiple tabs share the same anchor+placement. Lower = first */
  order: number
  _extensionName: string
}

/** WebUI contributions exposed for diagnostics/e2e validation */
export type IExtensionWebuiContribution = {
  extensionName: string
  apiRoutes: Array<{ path: string; auth: boolean }>
  staticAssets: Array<{ urlPrefix: string; directory: string }>
}

export type AgentActivityState = 'idle' | 'writing' | 'researching' | 'executing' | 'syncing' | 'error'

export type IExtensionAgentActivityEvent = {
  conversationId: string
  at: number
  kind: 'status' | 'tool' | 'message'
  text: string
}

export type IExtensionAgentActivityItem = {
  id: string
  backend: string
  agentName: string
  state: AgentActivityState
  runtimeStatus: 'pending' | 'running' | 'finished' | 'unknown'
  conversations: number
  activeConversations: number
  lastActiveAt: number
  lastStatus?: string
  currentTask?: string
  recentEvents: IExtensionAgentActivityEvent[]
}

export type IExtensionAgentActivitySnapshot = {
  generatedAt: number
  totalConversations: number
  runningConversations: number
  agents: IExtensionAgentActivityItem[]
}
