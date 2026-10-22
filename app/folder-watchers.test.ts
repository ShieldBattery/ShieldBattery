import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FolderWatchers } from './folder-watchers'

const WAIT = { timeout: 5000, interval: 20 }

describe('app/folder-watchers', () => {
  let base: string
  let watchers: FolderWatchers
  let changes: number

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'sb-folder-watchers-'))
    changes = 0
    watchers = new FolderWatchers(() => changes++, { warning: () => {} })
  })

  afterEach(() => {
    watchers.close()
    rmSync(base, { recursive: true, force: true, maxRetries: 5 })
  })

  async function expectChangeAfter(action: () => void): Promise<void> {
    // Lets events from earlier steps land first, so they aren't taken for this action's
    await new Promise(resolve => setTimeout(resolve, 100))
    const before = changes
    action()
    await vi.waitFor(() => expect(changes).toBeGreaterThan(before), WAIT)
  }

  test('reports changes inside a watched folder', async () => {
    const folder = path.join(base, 'maps')
    mkdirSync(folder)
    watchers.setFolders([folder])

    await expectChangeAfter(() => writeFileSync(path.join(folder, 'a.scx'), 'x'))
  })

  test('starts watching a folder once it is created', async () => {
    const folder = path.join(base, 'StarCraft', 'maps')
    watchers.setFolders([folder])

    await expectChangeAfter(() => mkdirSync(folder, { recursive: true }))
    await expectChangeAfter(() => writeFileSync(path.join(folder, 'a.scx'), 'x'))
  })

  test('watches a folder again after it is deleted and recreated', async () => {
    const folder = path.join(base, 'maps')
    mkdirSync(folder)
    watchers.setFolders([folder])

    rmSync(folder, { recursive: true, force: true, maxRetries: 5 })
    await vi.waitFor(() => expect(changes).toBeGreaterThan(0), WAIT)
    // Deleting a watched folder makes Windows report it changed over and over until its watch is
    // closed; once that's handled, the count stops climbing.
    await new Promise(resolve => setTimeout(resolve, 200))
    const settled = changes
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(changes - settled).toBeLessThan(10)

    await expectChangeAfter(() => mkdirSync(folder))
    await expectChangeAfter(() => writeFileSync(path.join(folder, 'a.scx'), 'x'))
  })
})
