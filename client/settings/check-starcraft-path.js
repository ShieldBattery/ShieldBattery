// This file should ONLY be imported for the Electron build

import fs from 'fs'
import path from 'path'
import thenify from 'thenify'
import childProcess from 'child_process'
import logger from '../logging/logger'

// Returns a promise that will resolve to a string version of the specified exe file (or reject with
// any errors that may occur)
function getExeVersion(filePath) {
  const command = process.env.SystemRoot ?
      path.join(process.env.SystemRoot, 'System32', 'wbem', 'wmic.exe') :
      'wmic.exe'
  const wmicCommand =
      `datafile where name="${filePath.replace(/"/g, '\\"').replace(/\\/g, '\\\\')}" get version`
  return new Promise((resolve, reject) => {
    let spawned
    try {
      spawned = childProcess.spawn(command, [])
    } catch (err) {
      reject(err)
    }

    let stdout = ''
    let err
    spawned.stdout.on('data', data => { stdout += data })
    spawned.on('error', e => { err = err || e })
      .on('close', (code, signal) => {
        if (err === undefined && code !== 0) {
          err = new Error('Non-zero exit code: ' + (signal || code))
        }
        if (err !== undefined) {
          reject(err)
          return
        }

        // Output should look like:
        // Version
        // 1.16.1.1
        const lines = stdout.split(/\r?\n/g)
        if (lines.length < 2 || !lines[0].startsWith('wmic:root\\cli>Version')) {
          reject(new Error('Malformed wmic output'))
          return
        }

        resolve(lines[1].trim())
      })

    spawned.stdin.end(wmicCommand)
  })
}

const accessAsync = thenify(fs.access)
export async function checkStarcraftPath(dirPath) {
  const filePath = path.join(dirPath, 'starcraft.exe')
  try {
    await accessAsync(filePath, fs.constants.R_OK)
  } catch (err) {
    return { path: false, version: false }
  }

  let version
  try {
    version = await getExeVersion(filePath)
  } catch (err) {
    logger.warning('Error getting exe version: ' + err)
    return { path: true, version: false }
  }

  return {
    path: true,
    version: version === '1.16.1.1'
  }
}
