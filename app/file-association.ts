import {
  DEFAULT_VALUE,
  HKCU,
  REG_NONE,
  REG_SZ,
  WindowsRegistry,
} from '@shieldbattery/windows-registry'
import { dialog } from 'electron'
import isDev from 'electron-is-dev'
import { getAppId } from './app-id'
import logger from './logger'

/**
 * Registers the currently running process in the registry as the associated program for the current
 * App ID. The App ID can then be used in file associations for particular filetypes.
 */
export async function registerCurrentProgram() {
  if (isDev) {
    // NOTE(tec27): We don't run the single-instance code in dev, so it's tough to test the file
    // association stuff properly there. It's also hard to launch the app from the right location
    // similar to how we do from pnpm, so we just don't do this registration. If you need to test
    // file associations, use an unpacked build.
    return
  }

  const appId = getAppId()

  const registry = new WindowsRegistry()
  try {
    await registry.write(
      HKCU,
      `SOFTWARE\\Classes\\${appId}\\shell\\open\\command`,
      DEFAULT_VALUE,
      REG_SZ,
      `"${process.execPath}" "%1"`,
    )
    await registry.write(
      HKCU,
      `SOFTWARE\\Classes\\${appId}\\DefaultIcon`,
      DEFAULT_VALUE,
      REG_SZ,
      `"${process.execPath}",0`,
    )
    await registry.write(
      HKCU,
      `SOFTWARE\\Classes\\.rep\\OpenWithProgids`,
      appId,
      REG_NONE,
      undefined,
    )
  } catch (err) {
    logger.error(`error setting file associations: ${(err as any).stack ?? err}`)
    dialog.showErrorBox(
      'ShieldBattery Error',
      `There was an error setting file associations: ${(err as any).stack ?? err}\r\n\r\n` +
        'This is a bug, please report it.',
    )
  } finally {
    registry.close()
  }
}
