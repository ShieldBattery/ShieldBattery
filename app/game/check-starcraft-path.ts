import fs, { promises as fsPromises } from 'fs'
import path from 'path'

async function checkRemasteredPath(dirPath: string): Promise<boolean> {
  const requiredFiles = ['x86/starcraft.exe', 'x86/clientsdk.dll']

  try {
    await Promise.all(
      requiredFiles.map(f => fsPromises.access(path.join(dirPath, f), fs.constants.R_OK)),
    )
    return true
  } catch (err) {
    return false
  }
}

export interface PathCheckResult {
  /** Whether the path contains a StarCraft installation. */
  path: boolean
  /** Whether the StarCraft installation is a compatible version. */
  version: boolean
}

// Given a path, returns an object with the following information:
//  - is this a valid StarCraft path
//  - does this path contain a supported StarCraft version
//  - is this a StarCraft:Remastered version of the game
export async function checkStarcraftPath(dirPath: string): Promise<PathCheckResult> {
  const result = { path: false, version: false }

  if (await checkRemasteredPath(dirPath)) {
    // NOTE(2Pac): For now we're assuming that every SC:R version is supported since we're updating
    // our offsets for each new patch dynamically thanks to neive's magic.
    return { ...result, path: true, version: true }
  }

  return result
}
