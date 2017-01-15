// This file will hold temporary stand-ins for the previously native functionality in psi
import Registry from 'winreg'
import electron from 'electron'
import fs from 'fs'
import path from 'path'
import thenify from 'thenify'

function readRegValue(hive, key, value) {
  return new Promise((resolve, reject) => {
    const reg = new Registry({ hive, key })
    reg.get(value, (err, result) => {
      if (err) {
        reject(err)
      } else {
        resolve(result.value)
      }
    })
  })
}

export async function getInstallPathFromRegistry() {
  const normalRegPath = '\\SOFTWARE\\Blizzard Entertainment\\Starcraft'
  const _6432RegPath = '\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\Starcraft'
  const regValueName = 'InstallPath'

  const attempts = [
    [ Registry.HKCU, normalRegPath ],
    [ Registry.HKCU, _6432RegPath ],
    [ Registry.HKLM, normalRegPath ],
    [ Registry.HKLM, _6432RegPath ],
  ]

  for (const [ hive, path ] of attempts) {
    try {
      const result = await readRegValue(hive, path, regValueName)
      if (result) {
        return result
      }
    } catch (err) {
      // Intentionally empty
    }
  }

  let recentMaps
  try {
    recentMaps = await readRegValue(Registry.HKCU, normalRegPath, 'Recent Maps')
  } catch (err) {
    // Intentionally empty
  }
  if (!recentMaps) {
    try {
      recentMaps = await readRegValue(Registry.HKCU, _6432RegPath, 'Recent Maps')
    } catch (err) {
      // Intentionally empty
    }
  }
  if (!recentMaps) {
    return undefined
  }

  // Filter out paths from 'Recent Maps' value saved in registry, until we get the one we can be
  // reasonably certain is a Starcraft install path. Assumption we make is that Starcraft's install
  // path must have the 'maps' folder.
  const localAppData = (process.env.LocalAppData || '').toLowerCase()
  const paths = recentMaps.split('\\0').filter(p => {
    const path = p.toLowerCase()
    return (path.includes('\\maps\\') &&
        !path.includes('\\programdata\\shieldbattery') &&
        (!localAppData || !path.includes(localAppData)))
  })
  if (!paths.length) {
    return undefined
  }

  // We make a reasonable guess that the remaining paths are all inside Starcraft folder. For now
  // we're not taking into account multiple different install paths, so just pick the first one.
  const path = paths[0]
  const mapsIndex = path.toLowerCase().lastIndexOf('\\maps\\')
  return path.slice(0, mapsIndex)
}

export async function checkStarcraftPath(path) {
  // FIXME(tec27): real implementation!
  return { path: true, version: true }
}

export async function detectResolution() {
  const { width, height } = electron.screen.getPrimaryDisplay().size
  return { width, height }
}

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
