// This file should ONLY be imported for the Electron build

import fs, { promises as fsPromises } from 'fs'
import path from 'path'
import glob from 'glob'
import logger from '../logging/logger'
import getFileHash from '../../app/common/get-file-hash'
import { REMASTERED, DOWNGRADE } from '../../app/common/flags'
import checkFileExists from '../../app/common/check-file-exists'
import getDowngradePath from '../downgrade/get-downgrade-path'

function globAsync(...args) {
  return new Promise((resolve, reject) => {
    glob(...args, (err, files) => {
      if (err) reject(err)
      else resolve(files)
    })
  })
}

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

async function checkRemasteredPath(dirPath) {
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
//  - are we using the downgrade path to launch StarCraft
export async function checkStarcraftPath(dirPath) {
  const result = { path: false, version: false, remastered: false, downgradePath: false }

  if (REMASTERED) {
    if (await checkRemasteredPath(dirPath)) {
      // NOTE(2Pac): For now we're assuming that every SC:R version is supported since we're
      // updating our offsets for each new patch dynamically thanks to neive's magic.
      return { ...result, path: true, version: true, remastered: true }
    }
  }
  const requiredFiles = ['starcraft.exe', 'storm.dll', 'stardat.mpq', 'broodat.mpq']

  try {
    await Promise.all(
      requiredFiles.map(f => fsPromises.access(path.join(dirPath, f), fs.constants.R_OK)),
    )
  } catch (err) {
    return result
  }

  // Due to 1.19 version moving local.dll to a separate folder, we need to handle it separately
  let localDllValid = await checkFileExists(path.join(dirPath, 'local.dll'))
  if (!localDllValid) {
    const matches = await globAsync(`${dirPath}/locales/*/local.dll`)
    if (matches.length < 1) {
      return result
    }
  }

  let [starcraftValid, stormValid] = await Promise.all([
    checkHash(path.join(dirPath, 'starcraft.exe'), EXE_HASHES_1161),
    checkHash(path.join(dirPath, 'storm.dll'), STORM_HASHES_1161),
  ])

  if (starcraftValid && stormValid && localDllValid) {
    return { ...result, path: true, version: true }
  }

  if (DOWNGRADE) {
    const downgradePath = getDowngradePath()

    ;[starcraftValid, stormValid, localDllValid] = await Promise.all([
      checkHash(path.join(downgradePath, 'starcraft.exe'), EXE_HASHES_1161),
      checkHash(path.join(downgradePath, 'storm.dll'), STORM_HASHES_1161),
      checkFileExists(path.join(downgradePath, 'local.dll')),
    ])

    if (starcraftValid && stormValid && localDllValid) {
      return { ...result, path: true, version: true, downgradePath: true }
    }
  }

  return { ...result, path: true }
}
