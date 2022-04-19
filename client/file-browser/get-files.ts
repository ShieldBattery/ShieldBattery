import { TypedIpcRenderer } from '../../common/ipc'
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
  try {
    const entries = (await ipcRenderer.invoke('fsReadDir', folderPath, { withFileTypes: true }))!
    return await Promise.all(
      entries.map(async entry => {
        const isFolder = entry.isDirectory
        const [name, extension] = isFolder ? [entry.name, ''] : splitExtension(entry.name)
        const stats = await ipcRenderer.invoke('fsStat', folderPath + '\\' + entry.name)
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
              date: stats?.mtime ?? new Date(0),
            }
      }),
    )
  } catch (err) {
    if ((err as any).code === 'ENOENT') {
      throw new Error('Filepath ' + folderPath + " doesn't exist")
    }
    throw err
  }
}
