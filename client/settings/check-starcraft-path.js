// This file should ONLY be imported for the Electron build

import fs from 'fs'
import path from 'path'
import thenify from 'thenify'
import logger from '../logging/logger'
import getFileHash from '../../app/common/get-file-hash'

const accessAsync = thenify(fs.access)

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
  const requiredFiles = ['starcraft.exe', 'storm.dll', 'local.dll', 'stardat.mpq', 'broodat.mpq']

  try {
    await Promise.all(requiredFiles.map(f => accessAsync(path.join(dirPath, f), fs.constants.R_OK)))
  } catch (err) {
    return { path: false, version: false, downgradePath: false }
  }

  let [starcraftValid, stormValid] = await Promise.all([
    checkHash(path.join(dirPath, 'starcraft.exe'), EXE_HASHES_1161),
    checkHash(path.join(dirPath, 'storm.dll'), STORM_HASHES_1161),
  ])

  if (starcraftValid && stormValid) {
    return { path: true, version: true, downgradePath: false }
  }

  ;[starcraftValid, stormValid] = await Promise.all([
    checkHash(path.join(downgradePath, 'starcraft.exe'), EXE_HASHES_1161),
    checkHash(path.join(downgradePath, 'storm.dll'), STORM_HASHES_1161),
  ])

  if (starcraftValid && stormValid) {
    return { path: true, version: true, downgradePath: true }
  } else {
    return { path: true, version: false, downgradePath: false }
  }
}
