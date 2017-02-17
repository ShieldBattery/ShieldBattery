import Registry from 'winreg'

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

// Attempts to find the StarCraft install path from the registry, using a combination of possible
// locations for the information. The possible locations are:
// HKCU\SOFTWARE\Blizzard Entertertainment\Starcraft\InstallPath
// HKLM\SOFTWARE\Blizzard Entertertainment\Starcraft\InstallPath
// HKCU\SOFTWARE\Blizzard Entertertainment\Starcraft\Recent Maps
// HKLM\SOFTWARE\Blizzard Entertertainment\Starcraft\Recent Maps
// (including WOW64 variants for all of the above keys)
export async function findInstallPath() {
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
        !/\\shieldbattery(|-dev|-local)\\maps\\/i.test(path) &&
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
