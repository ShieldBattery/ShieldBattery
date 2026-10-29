import { linkSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { installNativeLauncher } from './build-native-launcher.mjs'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'sb-native-install-'))
  directories.push(directory)
  const published = path.join(directory, 'store.node')
  const installed = path.join(directory, 'installed.node')
  const compiled = path.join(directory, 'compiled.node')
  writeFileSync(published, 'published package bytes')
  writeFileSync(compiled, 'locally compiled bytes')
  linkSync(published, installed)
  return { directory, published, installed, compiled }
}

test('installing the native build preserves hard-linked package-store bytes', () => {
  const f = fixture()
  installNativeLauncher(f.compiled, f.installed)
  expect(readFileSync(f.published, 'utf8')).toBe('published package bytes')
  expect(readFileSync(f.installed, 'utf8')).toBe('locally compiled bytes')
  expect(readdirSync(f.directory)).toHaveLength(3)
})

test('a failed native copy preserves the installed artifact and removes staging files', () => {
  const f = fixture()
  expect(() => installNativeLauncher(path.join(f.directory, 'missing.node'), f.installed)).toThrow()
  expect(readFileSync(f.published, 'utf8')).toBe('published package bytes')
  expect(readFileSync(f.installed, 'utf8')).toBe('published package bytes')
  expect(readdirSync(f.directory)).toHaveLength(3)
})
