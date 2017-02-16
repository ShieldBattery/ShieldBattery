// This file should ONLY be imported for the Electron build

import fs from 'fs'
import path from 'path'
import thenify from 'thenify'
import logger from '../logging/logger'
import HashThrough from '../../app/common/hash-through'

const accessAsync = thenify(fs.access)

const HASHES_1161 = [
  'ad6b58b27b8948845ccfa69bcfcc1b10d6aa7a27a371ee3e61453925288c6a46',
]

export async function checkStarcraftPath(dirPath) {
  const filePath = path.join(dirPath, 'starcraft.exe')
  try {
    await accessAsync(filePath, fs.constants.R_OK)
  } catch (err) {
    return { path: false, version: false }
  }

  const hasher = new HashThrough()
  fs.createReadStream(filePath).pipe(hasher)
  hasher.resume()
  let hash
  try {
    hash = await hasher.hashPromise
  } catch (err) {
    logger.error('Error hashing StarCraft executable: ' + err)
    return { path: true, version: false }
  }

  const matches = HASHES_1161.includes(hash)
  if (!matches) {
    logger.error('StarCraft executable has non-matching hash: ' + hash)
  }

  return {
    path: true,
    version: matches
  }
}
