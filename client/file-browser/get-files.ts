import { TypedIpcRenderer } from '../../common/ipc'

const ipcRenderer = new TypedIpcRenderer()

function splitExtension(filename: string): [base: string, ext: string] {
  const extensionAt = filename.lastIndexOf('.')
  if (extensionAt === -1) {
    return [filename, '']
  } else {
    return [filename.slice(0, extensionAt), filename.slice(extensionAt + 1)]
  }
}

export default async function readFolder(folderPath: string) {
  try {
    const entries = (await ipcRenderer.invoke('fsReadDir', folderPath, { withFileTypes: true }))!
    return await Promise.all(
      entries.map(async entry => {
        const isFolder = entry.isDirectory
        const [name, extension] = isFolder ? [entry.name, ''] : splitExtension(entry.name)
        const stats = await ipcRenderer.invoke('fsStat', folderPath + '\\' + entry.name)

        return {
          name,
          extension: extension.toLowerCase(),
          path: folderPath + '\\' + entry.name,
          isFolder,
          date: stats?.mtime,
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
