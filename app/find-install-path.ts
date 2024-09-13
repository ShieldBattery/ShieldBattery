import { HKCU, HKLM, Hkey, WindowsRegistry } from '@shieldbattery/windows-registry'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import logger from './logger.js'
import { ProductDb } from './vendor/blizzard/product_db.js'

/**
 * Attempts to find the StarCraft install path from various locations. First we check for the
 * Product DB from the Blizzard launcher (which is the most reliable source). If that can't be
 * found, we fall back to the registry, using a combination of possible locations for the
 * information. The possible locations are:
 *
 * - `HKCU\SOFTWARE\Blizzard Entertertainment\Starcraft\InstallPath`
 * - `HKLM\SOFTWARE\Blizzard Entertertainment\Starcraft\InstallPath`
 * - `HKCU\SOFTWARE\Blizzard Entertertainment\Starcraft\Recent Maps`
 * - `HKLM\SOFTWARE\Blizzard Entertertainment\Starcraft\Recent Maps`
 *
 * We also check WOW64 variants for all of the above keys.
 */
export async function findInstallPath(): Promise<string | undefined> {
  const programDataPath = process.env.ProgramData ?? 'C:\\ProgramData'
  const productDbPath = path.join(programDataPath, 'Battle.net', 'Agent', 'product.db')
  try {
    const productDbData = await readFile(productDbPath)
    const productDb = ProductDb.decode(productDbData)
    const scrInstall = productDb?.productInstalls?.find(
      i => i.uid === 's1' || i.productCode === 's1',
    )
    if (scrInstall && scrInstall.settings?.installPath) {
      return scrInstall.settings.installPath
    } else {
      logger.warn("product.db didn't contain a StarCraft install path")
    }
  } catch (err: any) {
    logger.warn(`Error while trying to read product.db: ${err?.stack ?? err}`)
  }

  const normalRegPath = 'SOFTWARE\\Blizzard Entertainment\\Starcraft'
  const _6432RegPath = 'SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\Starcraft'
  const regValueName = 'InstallPath'

  const attempts: Array<[hive: Hkey, key: string]> = [
    [HKCU, normalRegPath],
    [HKCU, _6432RegPath],
    [HKLM, normalRegPath],
    [HKLM, _6432RegPath],
  ]

  const registry = new WindowsRegistry()

  for (const [hive, regPath] of attempts) {
    try {
      const result = await registry.read(hive, regPath, regValueName)
      if (result && typeof result === 'string') {
        return result
      }
    } catch (err) {
      // Intentionally empty
    }
  }

  let recentMaps: unknown
  try {
    recentMaps = await registry.read(HKCU, normalRegPath, 'Recent Maps')
  } catch (err) {
    // Intentionally empty
  }
  if (!recentMaps) {
    try {
      recentMaps = await registry.read(HKCU, _6432RegPath, 'Recent Maps')
    } catch (err) {
      // Intentionally empty
    }
  }
  if (!recentMaps || typeof recentMaps !== 'string') {
    return undefined
  }

  // Filter out paths from 'Recent Maps' value saved in registry, until we get the one we can be
  // reasonably certain is a Starcraft install path. Assumption we make is that Starcraft's install
  // path must have the 'maps' folder.
  const localAppData = (process.env.LocalAppData || '').toLowerCase()
  const paths = recentMaps.split('\\0').filter(p => {
    const mapPath = p.toLowerCase()
    return (
      mapPath.includes('\\maps\\') &&
      !/\\shieldbattery(|-dev|-local)\\maps\\/i.test(mapPath) &&
      (!localAppData || !mapPath.includes(localAppData))
    )
  })
  if (!paths.length) {
    return undefined
  }

  // We make a reasonable guess that the remaining paths are all inside Starcraft folder. For now
  // we're not taking into account multiple different install paths, so just pick the first one.
  const resolvedPath = paths[0]
  const mapsIndex = resolvedPath.toLowerCase().lastIndexOf('\\maps\\')
  return resolvedPath.slice(0, mapsIndex)
}
