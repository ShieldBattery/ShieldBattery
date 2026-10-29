import { promises as fs } from 'node:fs'
import path from 'node:path'
import backgroundSettings from './background-csettings.json'

/** Canned SC:R settings for unattended clients, without any player/account settings. */
export const BACKGROUND_CSETTINGS = backgroundSettings

export const BACKGROUND_LOCAL_SETTINGS = {
  disableHd: true,
  gameWinX: 0,
  gameWinY: 0,
  gameWinWidth: 640,
  gameWinHeight: 480,
  masterVolume: 0,
  grabPanSensitivityOn: false,
  useCustomCursorSize: false,
} as const

/** Each process owns its settings file, including simultaneous launches of the same game ID. */
export async function createBackgroundGameSettings(userDataPath: string) {
  const parent = path.join(userDataPath, 'background-games')
  await fs.mkdir(parent, { recursive: true })
  const directory = await fs.mkdtemp(path.join(parent, 'client-'))
  const settingsFilePath = path.join(directory, 'CSettings.json')
  const dispose = async () => {
    await fs.rm(settingsFilePath, { force: true })
    await fs.rmdir(directory)
  }
  try {
    await fs.writeFile(settingsFilePath, JSON.stringify(BACKGROUND_CSETTINGS, null, 2), 'utf8')
  } catch (err) {
    await dispose().catch(() => {})
    throw err
  }
  return { settingsFilePath, dispose }
}
