import fs, { promises as fsPromises } from 'fs'
import glob from 'glob'
import path from 'path'
import { promisify } from 'util'
import checkFileExists from '../../common/check-file-exists'
import { BW_1161 } from '../../common/flags'
import getFileHash from '../../common/get-file-hash'
import logger from '../logger'

const globAsync = promisify(glob)

export const EXE_HASHES_1161 = ['ad6b58b27b8948845ccfa69bcfcc1b10d6aa7a27a371ee3e61453925288c6a46']
export const STORM_HASHES_1161 = [
  '706ff2164ca472f27c44235ed55586644e5c86e68cd69b62d76f5a78778bff25',
]

async function checkHash(path: string, validHashes: string[]) {
  let hash
  try {
    hash = await getFileHash(path)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.error(`Error hashing ${path}: ${err}`)
    }
    return false
  }

  return validHashes.includes(hash)
}

async function checkRemasteredPath(dirPath: string) {
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

// Given a path, returns an object with the following information:
//  - is this a valid StarCraft path
//  - does this path contain a supported StarCraft version
//  - is this a StarCraft:Remastered version of the game
export async function checkStarcraftPath(dirPath: string) {
  const result = { path: false, version: false, remastered: false }

  if (await checkRemasteredPath(dirPath)) {
    // NOTE(2Pac): For now we're assuming that every SC:R version is supported since we're updating
    // our offsets for each new patch dynamically thanks to neive's magic.
    return { ...result, path: true, version: true, remastered: true }
  }

  if (!BW_1161) return result

  const requiredFiles = ['starcraft.exe', 'storm.dll', 'stardat.mpq', 'broodat.mpq']

  try {
    await Promise.all(
      requiredFiles.map(f => fsPromises.access(path.join(dirPath, f), fs.constants.R_OK)),
    )
  } catch (err) {
    return result
  }

  // Due to 1.19 version moving local.dll to a separate folder, we need to handle it separately
  const localDllValid = await checkFileExists(path.join(dirPath, 'local.dll'))
  if (!localDllValid) {
    const matches = await globAsync(`${dirPath}/locales/*/local.dll`)
    if (matches.length < 1) {
      return result
    }
  }

  const [starcraftValid, stormValid] = await Promise.all([
    checkHash(path.join(dirPath, 'starcraft.exe'), EXE_HASHES_1161),
    checkHash(path.join(dirPath, 'storm.dll'), STORM_HASHES_1161),
  ])

  if (starcraftValid && stormValid && localDllValid) {
    return { ...result, path: true, version: true }
  }

  return { ...result, path: true }
}
