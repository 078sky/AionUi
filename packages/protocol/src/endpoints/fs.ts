// Filesystem endpoint types - extracted from ipcBridge.ts

export type IDirOrFile = {
  name: string
  fullPath: string
  relativePath: string
  isDir: boolean
  isFile: boolean
  children?: Array<IDirOrFile>
}

export type IFileMetadata = {
  name: string
  path: string
  size: number
  type: string
  lastModified: number
  isDirectory?: boolean
}
