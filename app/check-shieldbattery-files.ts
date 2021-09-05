import { app } from 'electron'
import { access } from 'fs/promises'
import path from 'path'
import { ShieldBatteryFile, ShieldBatteryFileResult } from '../common/shieldbattery-file'
import logger from './logger'

const FILES_TO_CHECK: [ShieldBatteryFile, string][] = [
  [ShieldBatteryFile.Init, path.join('game', 'dist', 'sb_init.dll')],
  [ShieldBatteryFile.Main, path.join('game', 'dist', 'shieldbattery.dll')],
]

export function checkShieldBatteryFiles(): Promise<ShieldBatteryFileResult[]> {
  const basePath = path.resolve(app.getAppPath(), '..')

  logger.verbose('checking important ShieldBattery files')

  return Promise.all(
    FILES_TO_CHECK.map(async ([sbFile, filePath]) => {
      let canAccess = false
      try {
        await access(path.resolve(basePath, filePath))
        canAccess = true
      } catch (err) {
        logger.error(`Error accessing ${filePath}: ${(err as any).stack ?? err}`)
      }

      const result: ShieldBatteryFileResult = [sbFile, canAccess]
      return result
    }),
  )
}
