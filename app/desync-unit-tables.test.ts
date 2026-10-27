import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { findNewestDesyncUnitTable } from './desync-unit-tables'

const DAY_MS = 24 * 60 * 60 * 1000

describe('app/desync-unit-tables', () => {
  let logsDir: string
  const now = Date.now()

  beforeEach(() => {
    logsDir = mkdtempSync(path.join(tmpdir(), 'sb-desync-unit-tables-'))
  })

  afterEach(() => {
    rmSync(logsDir, { recursive: true, force: true, maxRetries: 5 })
  })

  function writeAged(name: string, ageMs: number) {
    const filePath = path.join(logsDir, name)
    writeFileSync(filePath, 'x')
    const time = new Date(now - ageMs)
    utimesSync(filePath, time, time)
    return filePath
  }

  test('finds nothing when no table was written', async () => {
    writeAged('game.0.log', 0)
    expect(await findNewestDesyncUnitTable(logsDir, now)).toBeUndefined()
  })

  test('picks the newest table', async () => {
    writeAged('desync-units-older.csv', 2 * DAY_MS)
    const newest = writeAged('desync-units-newer.csv', DAY_MS)
    writeAged('rollback-probe-1-2.csv', 0)
    expect(await findNewestDesyncUnitTable(logsDir, now)).toBe(newest)
  })

  test('ignores tables older than a week', async () => {
    writeAged('desync-units-stale.csv', 8 * DAY_MS)
    expect(await findNewestDesyncUnitTable(logsDir, now)).toBeUndefined()
  })
})
