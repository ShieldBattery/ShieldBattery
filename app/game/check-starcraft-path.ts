import fs, { promises as fsPromises } from 'fs'
import path from 'path'
import log from '../logger'
import { readFileVersion } from './pe-version'

/**
 * The oldest StarCraft: Remastered build (1.23.10) we can play games on. Older builds still run
 * with ShieldBattery, but desync against 1.23.10 clients on the first sync check of every game.
 */
const MIN_STARCRAFT_BUILD = 11026

const STARCRAFT_EXECUTABLES = ['x86/starcraft.exe', 'x86_64/starcraft.exe']

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

async function checkRemasteredVersion(dirPath: string): Promise<boolean> {
  const builds = await Promise.all(
    STARCRAFT_EXECUTABLES.map(f =>
      readFileVersion(path.join(dirPath, f)).then(
        version => version?.[3],
        () => undefined,
      ),
    ),
  )
  if (builds.every(build => build !== undefined && build >= MIN_STARCRAFT_BUILD)) {
    return true
  }

  log.warn(
    `StarCraft at ${dirPath} is not a supported version (need build ${MIN_STARCRAFT_BUILD}+): ` +
      STARCRAFT_EXECUTABLES.map((f, i) => `${f} is build ${builds[i] ?? 'unknown'}`).join(', '),
  )
  return false
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
export async function checkStarcraftPath(dirPath: string): Promise<PathCheckResult> {
  if (!(await checkRemasteredPath(dirPath))) {
    return { path: false, version: false }
  }

  return { path: true, version: await checkRemasteredVersion(dirPath) }
}
