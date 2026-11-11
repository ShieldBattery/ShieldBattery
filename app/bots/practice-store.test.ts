import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDefaultPracticeStore } from '../../common/bots/practice'
import { loadPracticeStore, savePracticeStore } from './practice-store'

describe('app/bots/practice-store', () => {
  let directory: string
  let filePath: string

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-practice-store-'))
    filePath = path.join(directory, 'practice.json')
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  test('returns nothing when there is no file', async () => {
    await expect(loadPracticeStore(filePath)).resolves.toBeUndefined()
  })

  test('round-trips a saved setup', async () => {
    const data = createDefaultPracticeStore()
    data.matchmaking.playerRace = 'z'
    data.recentMapIds = []
    await savePracticeStore(filePath, data)
    await expect(loadPracticeStore(filePath)).resolves.toEqual(data)
  })

  test('leaves no temporary files behind', async () => {
    await savePracticeStore(filePath, createDefaultPracticeStore())
    await expect(fs.readdir(directory)).resolves.toEqual(['practice.json'])
  })

  test('rejects a file from another version', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({ ...createDefaultPracticeStore(), version: 99 }),
      'utf8',
    )
    await expect(loadPracticeStore(filePath)).rejects.toThrow(/different version/)
  })

  test('rejects a file that is not a practice setup', async () => {
    await fs.writeFile(filePath, JSON.stringify({ version: 1 }), 'utf8')
    await expect(loadPracticeStore(filePath)).rejects.toThrow()
  })

  test('leaves an unreadable file on disk', async () => {
    await fs.writeFile(filePath, 'not json at all', 'utf8')
    await expect(loadPracticeStore(filePath)).rejects.toThrow()
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe('not json at all')
  })

  test('refuses to save data from another version', async () => {
    await expect(
      savePracticeStore(filePath, { ...createDefaultPracticeStore(), version: 2 as any }),
    ).rejects.toThrow()
  })
})
