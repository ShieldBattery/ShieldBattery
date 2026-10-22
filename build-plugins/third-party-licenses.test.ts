import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  ADDON_LICENSES_FILE,
  isAllowed,
  packageDirOf,
  readAddonLicenses,
  repositoryUrl,
} from './third-party-licenses'

describe('isAllowed', () => {
  test('accepts a single allowed license', () => {
    expect(isAllowed('MIT')).toBe(true)
  })

  test('rejects a license that is not allowed', () => {
    expect(isAllowed('GPL-3.0-only')).toBe(false)
  })

  test('accepts an OR when either side is allowed', () => {
    expect(isAllowed('GPL-2.0-only OR MIT')).toBe(true)
    expect(isAllowed('(MIT OR Apache-2.0)')).toBe(true)
  })

  test('requires every side of an AND to be allowed', () => {
    expect(isAllowed('MIT AND ISC')).toBe(true)
    expect(isAllowed('MIT AND GPL-3.0-only')).toBe(false)
  })

  test('binds AND tighter than OR', () => {
    expect(isAllowed('GPL-3.0-only AND MIT OR ISC')).toBe(true)
    expect(isAllowed('ISC OR MIT AND GPL-3.0-only')).toBe(true)
    expect(isAllowed('(ISC OR MIT) AND GPL-3.0-only')).toBe(false)
  })

  test('judges a license with an exception by its base license', () => {
    expect(isAllowed('Apache-2.0 WITH LLVM-exception')).toBe(true)
  })

  test('treats a trailing + as the license it extends', () => {
    expect(isAllowed('MPL-2.0+')).toBe(true)
  })

  test('rejects things that are not SPDX expressions', () => {
    expect(isAllowed('UNKNOWN')).toBe(false)
    expect(isAllowed('SEE LICENSE IN LICENSE.md')).toBe(false)
    expect(isAllowed('Public Domain')).toBe(false)
    expect(isAllowed('')).toBe(false)
    expect(isAllowed('(MIT')).toBe(false)
    expect(isAllowed('MIT OR')).toBe(false)
  })
})

describe('packageDirOf', () => {
  test('finds the package of a module in a pnpm store', () => {
    expect(
      packageDirOf('C:\\repo\\node_modules\\.pnpm\\react@19.0.0\\node_modules\\react\\index.js'),
    ).toBe('C:/repo/node_modules/.pnpm/react@19.0.0/node_modules/react')
  })

  test('handles scoped packages', () => {
    expect(
      packageDirOf('/repo/node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg/dist/a.js'),
    ).toBe('/repo/node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg')
  })

  test('ignores queries on the module id', () => {
    expect(packageDirOf('/repo/node_modules/pkg/style.css?inline')).toBe('/repo/node_modules/pkg')
  })

  test('skips our own code and virtual modules', () => {
    expect(packageDirOf('/repo/client/index.tsx')).toBeUndefined()
    expect(packageDirOf('\0rolldown/runtime.js')).toBeUndefined()
  })
})

describe('repositoryUrl', () => {
  test('expands GitHub shorthands', () => {
    expect(repositoryUrl('user/repo')).toBe('https://github.com/user/repo')
    expect(repositoryUrl('github:user/repo')).toBe('https://github.com/user/repo')
  })

  test('turns git URLs into browsable ones', () => {
    expect(repositoryUrl({ url: 'git+https://github.com/user/repo.git' })).toBe(
      'https://github.com/user/repo',
    )
    expect(repositoryUrl('git://github.com/user/repo.git')).toBe('https://github.com/user/repo')
    expect(repositoryUrl({ url: 'git+ssh://git@github.com/user/repo.git' })).toBe(
      'https://github.com/user/repo',
    )
  })

  test('is undefined without a repository', () => {
    expect(repositoryUrl(undefined)).toBeUndefined()
  })
})

describe('readAddonLicenses', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'addon-licenses-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('reads the packages listed beside an addon', async () => {
    const packages = [
      {
        name: 'some-crate',
        version: '1.2.3',
        license: 'MIT OR Apache-2.0',
        licenseFiles: [{ fileName: 'MIT', text: 'MIT License' }],
      },
    ]
    await writeFile(
      path.join(dir, ADDON_LICENSES_FILE),
      JSON.stringify({ build: 'addon', packages }),
    )

    const result = await readAddonLicenses(path.join(dir, 'index.node'))
    expect(result.packages).toEqual(packages)
  })

  test('fails for an addon that ships no licenses file', async () => {
    await expect(readAddonLicenses(path.join(dir, 'index.node'))).rejects.toThrow()
  })

  test('fails for a licenses file without a packages list', async () => {
    await writeFile(path.join(dir, ADDON_LICENSES_FILE), JSON.stringify({ build: 'addon' }))
    await expect(readAddonLicenses(path.join(dir, 'index.node'))).rejects.toThrow(
      'no packages list',
    )
  })
})
