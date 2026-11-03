import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ScrSettingsManager } from './settings'

vi.mock('./logger', () => ({
  default: {
    log: () => {},
    verbose: () => {},
    info: () => {},
    debug: () => {},
    warning: () => {},
    error: () => {},
  },
}))
vi.mock('./find-install-path', () => ({ findInstallPath: async () => undefined }))
// Watching a file in a directory that's then removed fails on Windows, and no test needs a watcher.
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>()
  const watch = () => ({ close: () => {} })
  return { ...actual, default: { ...actual, watch }, watch }
})

/** SC:R's name for the mouse scroll speed setting in its settings file. */
const MOUSE_SCROLL_SPEED = 'm_mscroll'

let dir: string
let sbPath: string
let blizzardPath: string
let gamePath: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sb-scr-settings-'))
  sbPath = path.join(dir, 'sb.json')
  blizzardPath = path.join(dir, 'CSettings.json')
  gamePath = path.join(dir, 'game.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function createManager(
  sbSettings: Record<string, unknown>,
  blizzardSettings?: Record<string, unknown>,
) {
  await writeFile(sbPath, JSON.stringify({ version: 6, ...sbSettings }))
  if (blizzardSettings) {
    await writeFile(blizzardPath, JSON.stringify(blizzardSettings))
  }
  const manager = new ScrSettingsManager(sbPath, blizzardPath, gamePath)
  await manager.untilInitialized()
  return manager
}

/** Stands in for SC:R changing its own settings file while a game runs. */
async function editGameFile(changes: Record<string, unknown>) {
  const contents = JSON.parse(await readFile(gamePath, { encoding: 'utf8' }))
  await writeFile(gamePath, JSON.stringify({ ...contents, ...changes }))
}

describe('ScrSettingsManager', () => {
  test('copying from Battle.net replaces only the settings its file holds usable values for', async () => {
    const manager = await createManager(
      { mouseSensitivityOn: true, mouseSensitivity: 15, mouseScrollSpeed: 1, soundVolume: 20 },
      {
        MouseUseSensitivity: true,
        MouseSensitivity: 50,
        [MOUSE_SCROLL_SPEED]: 9,
        Gamma: 200,
        somethingUnmapped: 1,
      },
    )

    const result = await manager.copyFromBlizzard()

    expect(result).toEqual({ found: true, changed: ['mouseSensitivity', 'gamma'] })
    expect(await manager.get()).toMatchObject({
      mouseSensitivityOn: true,
      mouseSensitivity: 50,
      mouseScrollSpeed: 1,
      soundVolume: 20,
      gamma: 140,
    })
  })

  test('copying without a Battle.net settings file changes nothing', async () => {
    const manager = await createManager({ mouseSensitivity: 15 })

    expect(await manager.copyFromBlizzard()).toEqual({ found: false })
    expect(await manager.getBlizzardSettings()).toEqual({ found: false })
    expect((await manager.get()).mouseSensitivity).toBe(15)
  })

  test('changes made while a game runs survive reading its settings file back', async () => {
    const manager = await createManager({ mouseSensitivity: 15, mouseScrollSpeed: 1 })
    await manager.writeGameSettingsFile()

    await manager.merge({ mouseSensitivity: 40 })
    await editGameFile({ [MOUSE_SCROLL_SPEED]: 4 })
    await manager.syncWithGameSettingsFile()

    expect(await manager.get()).toMatchObject({ mouseSensitivity: 40, mouseScrollSpeed: 4 })
  })

  test('changes made before a game launched yield to what the game wrote', async () => {
    const manager = await createManager({ mouseSensitivity: 15 })
    await manager.merge({ mouseSensitivity: 40 })
    await manager.writeGameSettingsFile()

    await editGameFile({ MouseSensitivity: 30 })
    await manager.syncWithGameSettingsFile()

    expect((await manager.get()).mouseSensitivity).toBe(30)
  })
})
