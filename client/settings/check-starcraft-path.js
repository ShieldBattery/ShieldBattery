// This file should ONLY be imported for the Electron build

import fs from 'fs'
import path from 'path'
import glob from 'glob'
import thenify from 'thenify'
import logger from '../logging/logger'
import getFileHash from '../../app/common/get-file-hash'
import checkFileExists from '../../app/common/check-file-exists'

const accessAsync = thenify(fs.access)
const globAsync = thenify(glob)

export const EXE_HASHES_1161 = ['ad6b58b27b8948845ccfa69bcfcc1b10d6aa7a27a371ee3e61453925288c6a46']
export const STORM_HASHES_1161 = [
  '706ff2164ca472f27c44235ed55586644e5c86e68cd69b62d76f5a78778bff25',
]

async function checkHash(path, validHashes) {
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

export async function checkRemasteredPath(dirPath) {
  const requiredFiles = ['x86/starcraft.exe', 'x86/clientsdk.dll']

  try {
    await Promise.all(requiredFiles.map(f => accessAsync(path.join(dirPath, f), fs.constants.R_OK)))
    return true
  } catch (err) {
    return false
  }
}

// Returns whether or not a StarCraft path is valid, along with whether or not the versions of
// files contained in it are the expected versions. A path is valid if it contains:
//   - StarCraft.exe
//   - storm.dll
//   - local.dll
//   - stardat.mpq
//   - broodat.mpq
//
// Any such directory might not be the correct version, but *should* be patchable to a usable
// version of the game.
//
// If the versions of the files contained in that directory are not valid, the downgradePath will
// be checked for other copies. If downgradePath contains files that match the correct hashes, this
// will be counted as having the correct version, but `downgradePath` will be true.
export async function checkStarcraftPath(dirPath, downgradePath) {
  if (await checkRemasteredPath(dirPath)) {
    return { path: true, version: true, downgradePath: false }
  }
  const requiredFiles = ['starcraft.exe', 'storm.dll', 'stardat.mpq', 'broodat.mpq']

  try {
    await Promise.all(requiredFiles.map(f => accessAsync(path.join(dirPath, f), fs.constants.R_OK)))
  } catch (err) {
    return { path: false, version: false, downgradePath: false }
  }

  // Due to 1.19 version moving local.dll to a separate folder, we need to handle it separately
  let localDllValid = await checkFileExists(path.join(dirPath, 'local.dll'))
  if (!localDllValid) {
    const matches = await globAsync(`${dirPath}/locales/*/local.dll`)
    if (matches.length < 1) {
      return { path: false, version: false, downgradePath: false }
    }
  }

  let [starcraftValid, stormValid] = await Promise.all([
    checkHash(path.join(dirPath, 'starcraft.exe'), EXE_HASHES_1161),
    checkHash(path.join(dirPath, 'storm.dll'), STORM_HASHES_1161),
  ])

  if (starcraftValid && stormValid && localDllValid) {
    return { path: true, version: true, downgradePath: false }
  }

  ;[starcraftValid, stormValid, localDllValid] = await Promise.all([
    checkHash(path.join(downgradePath, 'starcraft.exe'), EXE_HASHES_1161),
    checkHash(path.join(downgradePath, 'storm.dll'), STORM_HASHES_1161),
    checkFileExists(path.join(downgradePath, 'local.dll')),
  ])

  if (starcraftValid && stormValid && localDllValid) {
    return { path: true, version: true, downgradePath: true }
  } else {
    return { path: true, version: false, downgradePath: false }
  }
}
