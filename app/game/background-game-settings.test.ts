import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createBackgroundGameSettings } from './background-game-settings'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('concurrent clients isolate rewritten settings and preserve the player settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-background-test-'))
  roots.push(root)
  const playerPath = path.join(root, 'CSettings.json')
  const playerSettings = '{"HDPreferences":true,"MusicEnabled":true,"account":"player"}'
  await fs.writeFile(playerPath, playerSettings)
  const [first, second] = await Promise.all([
    createBackgroundGameSettings(root),
    createBackgroundGameSettings(root),
  ])
  expect(first.settingsFilePath).not.toBe(second.settingsFilePath)
  const secondContents = await fs.readFile(second.settingsFilePath, 'utf8')
  expect(JSON.parse(secondContents)).toMatchObject({
    HDPreferences: false,
    MusicEnabled: false,
    SfxEnabled: false,
    MouseConfine: false,
    WindowMode: 0,
  })
  expect(JSON.parse(secondContents)).not.toHaveProperty('account')
  await fs.writeFile(first.settingsFilePath, '{"rewrittenByGame":true}')
  await first.dispose()
  await expect(fs.access(first.settingsFilePath)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(second.settingsFilePath, 'utf8')).toBe(secondContents)
  expect(await fs.readFile(playerPath, 'utf8')).toBe(playerSettings)
  await second.dispose()
  expect(await fs.readdir(path.join(root, 'background-games'))).toEqual([])
})
