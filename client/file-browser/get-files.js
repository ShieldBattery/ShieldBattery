import { promises as fsPromises } from 'fs'
import path from 'path'

export default async function readFolder(folderPath) {
  const names = await fsPromises.readdir(folderPath)
  const stats = await Promise.all(
    names.map(async name => {
      const targetPath = path.join(folderPath, name)
      const stats = await fsPromises.stat(targetPath)
      return [name, targetPath, stats]
    }),
  )

  return stats
    .map(([name, targetPath, s]) => {
      return {
        isFolder: s.isDirectory(),
        name,
        path: targetPath,
        extension: !s.isDirectory()
          ? targetPath.substr(targetPath.lastIndexOf('.') + 1).toLowerCase()
          : '',
        date: s.mtime,
      }
    })
    .map(f => {
      if (!f.isFolder) {
        f.name = f.name.slice(0, -4)
      }
      return f
    })
}
