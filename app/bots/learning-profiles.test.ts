import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ensureWorkingCopy,
  hasLearningData,
  profileDirectoryName,
  profileRelativeWritablePath,
  resetLearning,
} from './learning-profiles'

describe('app/bots/learning-profiles/profileDirectoryName', () => {
  test('leaves a catalog ID alone', () => {
    expect(profileDirectoryName('zzzkbot')).toBe('zzzkbot')
  })

  test('replaces characters a path cannot hold', () => {
    expect(profileDirectoryName('local:8a7b-1')).toBe('local_8a7b-1')
  })
})

describe('app/bots/learning-profiles/profileRelativeWritablePath', () => {
  test('passes paths through when the package root is the working directory', () => {
    expect(profileRelativeWritablePath('.', 'bwapi-data/write')).toBe('bwapi-data/write')
  })

  test('strips the working directory prefix', () => {
    expect(profileRelativeWritablePath('bot', 'bot/bwapi-data/write')).toBe('bwapi-data/write')
    expect(profileRelativeWritablePath('bot', 'bot')).toBe('.')
  })

  test('reports paths outside the working copy', () => {
    expect(profileRelativeWritablePath('bot', 'shared/data')).toBeUndefined()
  })
})

describe('app/bots/learning-profiles', () => {
  let root: string
  let packageDirectory: string
  let profilesRoot: string

  const baseline = () => ({
    directory: packageDirectory,
    writablePaths: ['bwapi-data/write'],
  })

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-bot-profiles-'))
    packageDirectory = path.join(root, 'package')
    profilesRoot = path.join(root, 'profiles')
    await fs.mkdir(path.join(packageDirectory, 'bwapi-data', 'read'), { recursive: true })
    await fs.mkdir(path.join(packageDirectory, 'bwapi-data', 'write'), { recursive: true })
    await fs.writeFile(path.join(packageDirectory, 'bot.exe'), 'binary')
    await fs.writeFile(path.join(packageDirectory, 'bwapi-data', 'read', 'opening.dat'), 'seed')
    await fs.writeFile(path.join(packageDirectory, 'bwapi-data', 'write', 'history.dat'), 'seed')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  test('seeds a working copy from the package', async () => {
    const workingCopy = await ensureWorkingCopy({
      profilesRoot,
      key: 'zzzkbot',
      instanceIndex: 0,
      baseline: baseline(),
    })

    expect(workingCopy).toBe(path.join(profilesRoot, 'zzzkbot', 'work'))
    await expect(
      fs.readFile(path.join(workingCopy, 'bwapi-data', 'write', 'history.dat'), 'utf8'),
    ).resolves.toBe('seed')
    await expect(fs.readFile(path.join(workingCopy, 'bot.exe'), 'utf8')).resolves.toBe('binary')
  })

  test('gives each instance its own copy and leaves an existing one alone', async () => {
    const first = await ensureWorkingCopy({
      profilesRoot,
      key: 'zzzkbot',
      instanceIndex: 0,
      baseline: baseline(),
    })
    await fs.writeFile(path.join(first, 'bwapi-data', 'write', 'history.dat'), 'learned')

    const second = await ensureWorkingCopy({
      profilesRoot,
      key: 'zzzkbot',
      instanceIndex: 1,
      baseline: baseline(),
    })
    expect(second).toBe(path.join(profilesRoot, 'zzzkbot', 'work-2'))
    await expect(
      fs.readFile(path.join(second, 'bwapi-data', 'write', 'history.dat'), 'utf8'),
    ).resolves.toBe('seed')

    const again = await ensureWorkingCopy({
      profilesRoot,
      key: 'zzzkbot',
      instanceIndex: 0,
      baseline: baseline(),
    })
    expect(again).toBe(first)
    await expect(
      fs.readFile(path.join(first, 'bwapi-data', 'write', 'history.dat'), 'utf8'),
    ).resolves.toBe('learned')
  })

  test('reports learning data only once a writable file changes', async () => {
    await expect(
      hasLearningData({ profilesRoot, key: 'zzzkbot', baseline: baseline() }),
    ).resolves.toBe(false)

    const workingCopy = await ensureWorkingCopy({
      profilesRoot,
      key: 'zzzkbot',
      instanceIndex: 0,
      baseline: baseline(),
    })
    await expect(
      hasLearningData({ profilesRoot, key: 'zzzkbot', baseline: baseline() }),
    ).resolves.toBe(false)

    // A file outside the writable directories isn't the bot's learning.
    await fs.writeFile(path.join(workingCopy, 'bwapi-data', 'read', 'notes.txt'), 'x')
    await expect(
      hasLearningData({ profilesRoot, key: 'zzzkbot', baseline: baseline() }),
    ).resolves.toBe(false)

    await fs.writeFile(path.join(workingCopy, 'bwapi-data', 'write', 'new.dat'), 'learned')
    await expect(
      hasLearningData({ profilesRoot, key: 'zzzkbot', baseline: baseline() }),
    ).resolves.toBe(true)
  })

  test('restores the baseline and keeps the rest of the working copy', async () => {
    const workingCopy = await ensureWorkingCopy({
      profilesRoot,
      key: 'zzzkbot',
      instanceIndex: 0,
      baseline: baseline(),
    })
    await fs.writeFile(path.join(workingCopy, 'bwapi-data', 'write', 'new.dat'), 'learned')
    await fs.writeFile(path.join(workingCopy, 'bwapi-data', 'write', 'history.dat'), 'learned more')
    await fs.writeFile(path.join(workingCopy, 'bot.cfg'), 'my settings')

    await resetLearning({ profilesRoot, key: 'zzzkbot', baseline: baseline() })

    await expect(
      fs.readFile(path.join(workingCopy, 'bwapi-data', 'write', 'history.dat'), 'utf8'),
    ).resolves.toBe('seed')
    await expect(
      fs.stat(path.join(workingCopy, 'bwapi-data', 'write', 'new.dat')),
    ).rejects.toThrow()
    await expect(fs.readFile(path.join(workingCopy, 'bot.cfg'), 'utf8')).resolves.toBe(
      'my settings',
    )
    await expect(
      hasLearningData({ profilesRoot, key: 'zzzkbot', baseline: baseline() }),
    ).resolves.toBe(false)
  })
})
