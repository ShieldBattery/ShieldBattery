import { execFile } from 'node:child_process'
import path from 'node:path'
import { getErrorStack } from '../common/errors'
import logger from './logger'

/** Mandatory label SIDs at or above High integrity, i.e. an elevated (or SYSTEM) token. */
const ELEVATED_INTEGRITY_SIDS = ['S-1-16-12288', 'S-1-16-16384']

/**
 * Logs (asynchronously) whether the app is running elevated. Elevation breaks things that cross
 * the integrity boundary (e.g. a non-elevated second instance can't reach the single-instance
 * pipe), so bug reports need to show it.
 */
export function logElevationStatus() {
  if (process.platform !== 'win32') {
    return
  }

  // Full path because other `whoami`s (e.g. Git for Windows' coreutils) can come first on PATH.
  // Its group names are localized but the SIDs aren't, so match on those.
  const whoami = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
  execFile(whoami, ['/groups', '/fo', 'csv', '/nh'], { windowsHide: true }, (err, stdout) => {
    if (err) {
      logger.warn(`Failed to determine elevation status: ${getErrorStack(err)}`)
      return
    }
    const elevated = ELEVATED_INTEGRITY_SIDS.some(sid => stdout.includes(`"${sid}"`))
    logger.info(`Running elevated: ${elevated}`)
  })
}
