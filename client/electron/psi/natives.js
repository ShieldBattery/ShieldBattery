// This file will hold temporary stand-ins for the previously native functionality in psi
import fs from 'fs'
import path from 'path'
import thenify from 'thenify'

const readdirAsync = thenify(fs.readdir)
const statAsync = thenify(fs.stat)
export async function readFolder(folderPath) {
  const names = await readdirAsync(folderPath)
  const stats = await Promise.all(names.map(async name => {
    const targetPath = path.join(folderPath, name)
    const stats = await statAsync(targetPath)
    return [ name, targetPath, stats ]
  }))

  return stats.map(([name, targetPath, s]) => {
    return {
      isFolder: s.isDirectory(),
      name,
      path: targetPath,
      date: s.mtime,
    }
  })
}
