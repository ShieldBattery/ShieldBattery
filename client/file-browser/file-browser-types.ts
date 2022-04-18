export enum FileBrowserType {
  Maps = 'maps',
  Replays = 'replays',
}

export enum FileBrowserEntryType {
  Up = 'up',
  File = 'file',
  Folder = 'folder',
}

export interface FileBrowserBaseEntry {
  type: FileBrowserEntryType
  name: string
  path: string
}

export interface FileBrowserUpEntry extends FileBrowserBaseEntry {
  type: typeof FileBrowserEntryType.Up
}

export interface FileBrowserFolderEntry extends FileBrowserBaseEntry {
  type: typeof FileBrowserEntryType.Folder
}

export interface FileBrowserFileEntry extends FileBrowserBaseEntry {
  type: typeof FileBrowserEntryType.File
  extension: string
  date: Date
}

export type FileBrowserEntry = FileBrowserUpEntry | FileBrowserFolderEntry | FileBrowserFileEntry

export enum FileBrowserRootFolderId {
  Default = 'default',
  Documents = 'documents',
}

export interface FileBrowserRootFolder {
  id: FileBrowserRootFolderId
  name: string
  path: string
}

export interface FileBrowserEntryConfig {
  icon: React.ReactElement
  onSelect: (entry: FileBrowserFileEntry) => void
}
