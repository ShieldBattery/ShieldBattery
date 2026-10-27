import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { LocalPlutoLaunch } from '../../common/games/local-game'

/** Original v2.0 md09b_1331000 assets are an indivisible release. */
export const PLUTO_V2_ASSETS = Object.freeze({
  'pluto.dll': '603fea2f77a4b652f29b832c2977cf5bc9d83bbcb927febd04499220020ce3bc',
  'pluto/pluto_infer.exe': '3f2814a51034b9817b396e52b38d30341ede506a2baedc7cbc11cb6ebcece2cc',
  'pluto/pluto_weights.bin': 'c53a559b4910777dc0e1c561c0d89d243091f465d8e9fc0f5f72e56597067d86',
})

export async function verifyPlutoFile(file: string, expected: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expected) || !(await fs.lstat(file)).isFile()) {
    throw new Error(`Invalid Pluto bundle asset: ${path.basename(file)}`)
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== expected) {
    throw new Error(`Pluto bundle hash mismatch: ${path.basename(file)}`)
  }
}

export async function verifyPlutoBundle(directory: string, companionSha256: string): Promise<void> {
  for (const name of ['', 'pluto', 'bwapi-data', 'bwapi-data/read', 'bwapi-data/write']) {
    try {
      if (!(await fs.lstat(path.join(directory, name))).isDirectory()) {
        throw new Error('Pluto bundle requires isolated directories without symbolic links')
      }
    } catch (error) {
      if (
        !(
          name.startsWith('bwapi-data') &&
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      )
        throw error
    }
  }
  for (const name of ['companion.log', 'pluto.log', 'pluto_infer.log', 'pluto/pluto_config.json']) {
    try {
      if (!(await fs.lstat(path.join(directory, name))).isFile())
        throw new Error('Pluto writable files must not be symbolic links')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  await verifyPlutoFile(path.join(directory, 'pluto-companion.dll'), companionSha256)
  for (const [name, hash] of Object.entries(PLUTO_V2_ASSETS)) {
    await verifyPlutoFile(path.join(directory, name), hash)
  }
}

export async function verifyPlutoLaunch(launch: LocalPlutoLaunch): Promise<void> {
  if (
    launch.botPath !== path.join(launch.workingDirectory, 'pluto.dll') ||
    launch.companionPath !== path.join(launch.workingDirectory, 'pluto-companion.dll') ||
    launch.logPath !== path.join(launch.workingDirectory, 'companion.log')
  ) {
    throw new Error('Pluto launch paths must belong to its isolated profile')
  }
  await verifyPlutoBundle(launch.workingDirectory, launch.companionSha256)
}
