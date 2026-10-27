import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { verifyPlutoBundle, verifyPlutoFile, verifyPlutoLaunch } from './pluto-bundle'

test('verified companion bytes cannot be replaced after registration', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-pluto-'))
  try {
    const file = path.join(directory, 'pluto-companion.dll')
    const bytes = Buffer.from('local companion fixture')
    const hash = createHash('sha256').update(bytes).digest('hex')
    await fs.writeFile(file, bytes)
    await expect(verifyPlutoFile(file, hash)).resolves.toBeUndefined()
    await fs.writeFile(file, 'modified companion')
    await expect(verifyPlutoFile(file, hash)).rejects.toThrow('hash mismatch')
    await expect(verifyPlutoFile(file, 'not a hash')).rejects.toThrow('Invalid Pluto')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('a bundle cannot use a different profile for code or learning logs', async () => {
  const directory = path.resolve('pluto-profile')
  await expect(
    verifyPlutoLaunch({
      companionPath: path.join(directory, 'pluto-companion.dll'),
      companionSha256: 'a'.repeat(64),
      botPath: path.join(directory, 'pluto.dll'),
      logPath: path.resolve('another-profile', 'companion.log'),
      workingDirectory: directory,
    }),
  ).rejects.toThrow('isolated profile')
})

test('a linked bundle cannot turn a managed profile into the original writable directory', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-pluto-link-'))
  try {
    const actual = path.join(directory, 'actual')
    const link = path.join(directory, 'linked')
    await fs.mkdir(actual)
    await fs.symlink(actual, link, 'junction')
    await expect(verifyPlutoBundle(link, 'a'.repeat(64))).rejects.toThrow('isolated directories')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
