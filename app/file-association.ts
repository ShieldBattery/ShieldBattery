import isDev from 'electron-is-dev'
import { getAppId } from './app-id'
import { DEFAULT_VALUE, HKCU, REG_NONE, REG_SZ, setRegistryValue } from './registry'

/**
 * Registers the currently running process in the registry as the associated program for the current
 * App ID. The App ID can then be used in file associations for particular filetypes.
 */
export async function registerCurrentProgram() {
  if (isDev) {
    // NOTE(tec27): We don't run the single-instance code in dev, so it's tough to test the file
    // association stuff properly there. It's also hard to launch the app from the right location
    // similar to how we do from yarn, so we just don't do this registration. If you need to test
    // file associations, use an unpacked build.
    return
  }

  const appId = getAppId()

  await setRegistryValue({
    hive: HKCU,
    key: `\\SOFTWARE\\Classes\\${appId}\\shell\\open\\command`,
    name: DEFAULT_VALUE,
    type: REG_SZ,
    value: `"${process.execPath}" "%1"`,
  })
  await setRegistryValue({
    hive: HKCU,
    key: `\\SOFTWARE\\Classes\\${appId}\\DefaultIcon`,
    name: DEFAULT_VALUE,
    type: REG_SZ,
    value: `"${process.execPath}",0`,
  })

  await setRegistryValue({
    hive: HKCU,
    key: `\\SOFTWARE\\Classes\\.rep\\OpenWithProgids`,
    name: appId,
    type: REG_NONE,
    value: '',
  })
}
