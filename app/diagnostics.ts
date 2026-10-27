import { app, crashReporter, screen } from 'electron'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getErrorStack } from '../common/errors'
import logger from './logger'

/**
 * Starts Electron's crash reporter in local-only mode, so native crashes of the main, renderer, and
 * GPU processes leave minidumps in the `crashDumps` directory. Has to run before the app is ready
 * for child processes to be covered, and after `userData` has been settled (the dump directory
 * derives from it).
 */
export function startLocalCrashReporter() {
  crashReporter.start({ uploadToServer: false })
}

interface CrashDump {
  name: string
  modified: Date
}

async function findCrashDumps(dir: string): Promise<CrashDump[]> {
  const entries = await fsPromises.readdir(dir, { recursive: true, withFileTypes: true })
  const dumps = await Promise.all(
    entries
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.dmp'))
      .map(async e => ({
        name: e.name,
        modified: (await fsPromises.stat(path.join(e.parentPath, e.name))).mtime,
      })),
  )
  return dumps
}

/**
 * Logs how many minidumps are sitting in the crash dump directory and which is the newest, so a
 * log can show that a native crash happened since the last run.
 */
export async function logCrashDumps() {
  try {
    const dumps = await findCrashDumps(app.getPath('crashDumps'))
    if (!dumps.length) {
      logger.info('Crash dumps: 0')
      return
    }
    const newest = dumps.reduce((a, b) => (b.modified > a.modified ? b : a))
    logger.info(
      `Crash dumps: ${dumps.length}, newest: ${newest.name} (${newest.modified.toISOString()})`,
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      logger.info('Crash dumps: 0')
    } else {
      logger.warning(`Failed to check for crash dumps: ${getErrorStack(err)}`)
    }
  }
}

interface GpuDevice {
  active?: boolean
  vendorId?: number
  deviceId?: number
  driverVersion?: string
}

function hex(n: number | undefined) {
  return n === undefined ? '?' : '0x' + n.toString(16).padStart(4, '0')
}

/** Logs OS, CPU, memory, display, and GPU details. Must be called once the app is ready. */
export function logMachineInfo() {
  const cpus = os.cpus()
  logger.info(
    `System: ${process.platform} ${process.getSystemVersion()} (release ${os.release()}), ` +
      `arch ${process.arch}, ${cpus[0]?.model.trim() ?? 'unknown CPU'} x${cpus.length} logical, ` +
      `${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB RAM`,
  )

  const primaryId = screen.getPrimaryDisplay().id
  const displays = screen
    .getAllDisplays()
    .map(
      d =>
        `${d.size.width}x${d.size.height}@${d.scaleFactor}x ${d.displayFrequency}Hz` +
        (d.id === primaryId ? ' (primary)' : ''),
    )
  logger.info(`Displays: ${displays.join(', ')}`)

  app
    .getGPUInfo('basic')
    .then(info => {
      const devices = ((info as { gpuDevice?: GpuDevice[] }).gpuDevice ?? []).map(
        d =>
          `vendor ${hex(d.vendorId)} device ${hex(d.deviceId)} driver ${d.driverVersion ?? '?'}` +
          (d.active ? ' (active)' : ''),
      )
      logger.info(`GPUs: ${devices.length ? devices.join('; ') : 'none reported'}`)
    })
    .catch(err => {
      logger.warning(`Failed to get GPU info: ${getErrorStack(err)}`)
    })
}
