import { FsErrorCode, TypedIpcRenderer } from '../../common/ipc'
import { FileBrowserEntry, FileBrowserEntryType } from './file-browser-types'

const ipcRenderer = new TypedIpcRenderer()

function splitExtension(filename: string): [base: string, ext: string] {
  const extensionAt = filename.lastIndexOf('.')
  if (extensionAt === -1) {
    return [filename, '']
  } else {
    return [filename.slice(0, extensionAt), filename.slice(extensionAt + 1)]
  }
}

export default async function readFolder(folderPath: string): Promise<FileBrowserEntry[]> {
  const readDirResult = (await ipcRenderer.invoke('fsReadDir', folderPath, {
    withFileTypes: true,
  }))!
  if (readDirResult.error) {
    if (readDirResult.code === FsErrorCode.FileOrFolderMissing) {
      throw new Error('Filepath ' + folderPath + " doesn't exist")
    } else {
      throw new Error('Unexpected FsError: ' + readDirResult.code)
    }
  }
  return await Promise.all(
    readDirResult.entries.map(async entry => {
      const isFolder = entry.isDirectory
      const [name, extension] = isFolder ? [entry.name, ''] : splitExtension(entry.name)
      const statsResult = await ipcRenderer.invoke('fsStat', folderPath + '\\' + entry.name)!
      if (statsResult.error) {
        if (statsResult.code === FsErrorCode.FileOrFolderMissing) {
          throw new Error('Filepath ' + folderPath + " doesn't exist")
        } else {
          throw new Error('Unexpected FsError: ' + statsResult.code)
        }
      }
      const path = folderPath + '\\' + entry.name

      return isFolder
        ? {
            type: FileBrowserEntryType.Folder,
            name,
            path,
          }
        : {
            type: FileBrowserEntryType.File,
            name,
            path,
            extension: extension.toLowerCase(),
            date: statsResult.stats.mtime ?? new Date(0),
          }
    }),
  )
}
