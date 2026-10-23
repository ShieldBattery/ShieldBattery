import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { checkStarcraftPath } from './check-starcraft-path'
import { FileVersion } from './pe-version'
import { makeFakePeFile } from './testing/fake-pe-file'

vi.mock('../logger', () => ({
  default: { warn: () => {} },
}))

describe('app/game/check-starcraft-path', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'sb-check-starcraft-path-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeInstall({
    x86,
    x64,
    clientSdk = true,
  }: {
    x86: FileVersion
    x64?: FileVersion
    clientSdk?: boolean
  }) {
    mkdirSync(path.join(dir, 'x86'))
    writeFileSync(
      path.join(dir, 'x86', 'starcraft.exe'),
      makeFakePeFile({ is64Bit: false, fileVersion: x86 }),
    )
    if (clientSdk) {
      writeFileSync(path.join(dir, 'x86', 'clientsdk.dll'), '')
    }
    if (x64) {
      mkdirSync(path.join(dir, 'x86_64'))
      writeFileSync(path.join(dir, 'x86_64', 'starcraft.exe'), makeFakePeFile({ fileVersion: x64 }))
    }
  }

  test('accepts the first 1.23.10 build', async () => {
    writeInstall({ x86: [1, 23, 10, 11026], x64: [1, 23, 10, 11026] })
    expect(await checkStarcraftPath(dir)).toEqual({ path: true, version: true })
  })

  test('accepts newer builds', async () => {
    writeInstall({ x86: [1, 23, 10, 13515], x64: [1, 23, 10, 13515] })
    expect(await checkStarcraftPath(dir)).toEqual({ path: true, version: true })
  })

  test('rejects 1.23.9 builds', async () => {
    writeInstall({ x86: [1, 23, 9, 10145], x64: [1, 23, 9, 10145] })
    expect(await checkStarcraftPath(dir)).toEqual({ path: true, version: false })
  })

  test('rejects an install where either executable is outdated', async () => {
    writeInstall({ x86: [1, 23, 10, 13515], x64: [1, 23, 9, 10870] })
    expect(await checkStarcraftPath(dir)).toEqual({ path: true, version: false })
  })

  test('rejects an install without a 64-bit executable', async () => {
    writeInstall({ x86: [1, 23, 10, 13515] })
    expect(await checkStarcraftPath(dir)).toEqual({ path: true, version: false })
  })

  test('rejects a directory that is not a StarCraft install', async () => {
    writeInstall({ x86: [1, 23, 10, 13515], x64: [1, 23, 10, 13515], clientSdk: false })
    expect(await checkStarcraftPath(dir)).toEqual({ path: false, version: false })
  })
})
