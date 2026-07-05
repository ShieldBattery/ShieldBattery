import { describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { areAllHumansAccountedFor, setReportedResults } from './games-users'

vi.mock('../db', () => ({
  default: vi.fn(),
}))

const GAME_ID = '11111111-2222-4333-8444-555555555555'
const USER_ID = makeSbUserId(7)

/** Stubs `db()` to hand back a fake client whose `query` calls are captured for assertions. */
function mockDbClient() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
  const done = vi.fn()
  asMockedFunction(db).mockResolvedValue({ client: { query } as any, done })
  return query
}

/** Stubs `db()` so the query resolves with the given `bool_and`/`count` row. */
function mockAccountingRow(row: { allAccounted: boolean | null; total: string } | undefined) {
  const query = vi.fn().mockResolvedValue({
    rows: row
      ? [
          // eslint-disable-next-line camelcase
          { all_accounted: row.allAccounted, total: row.total },
        ]
      : [],
    rowCount: row ? 1 : 0,
  })
  const done = vi.fn()
  asMockedFunction(db).mockResolvedValue({ client: { query } as any, done })
  return query
}

describe('models/games-users/areAllHumansAccountedFor', () => {
  test('is true when every row has reported results or a departure', async () => {
    mockAccountingRow({ allAccounted: true, total: '2' })

    expect(await areAllHumansAccountedFor(GAME_ID)).toBe(true)
  })

  test('is false when at least one row has neither', async () => {
    mockAccountingRow({ allAccounted: false, total: '2' })

    expect(await areAllHumansAccountedFor(GAME_ID)).toBe(false)
  })

  test('is false when the game has no games_users rows at all', async () => {
    mockAccountingRow({ allAccounted: null, total: '0' })

    expect(await areAllHumansAccountedFor(GAME_ID)).toBe(false)
  })

  test('is false when the query returns no row', async () => {
    mockAccountingRow(undefined)

    expect(await areAllHumansAccountedFor(GAME_ID)).toBe(false)
  })
})

describe('models/games-users/setReportedResults', () => {
  test('writes the given relay stamps', async () => {
    const query = mockDbClient()
    const relayReportTime = new Date('2026-07-04T00:00:00.000Z')

    await setReportedResults({
      userId: USER_ID,
      gameId: GAME_ID,
      reportedResults: { time: 1000, playerResults: [] },
      reportedAt: new Date('2026-07-04T00:00:01.000Z'),
      relayReportTime,
      relayReportFrame: 42,
    })

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.values).toContain(relayReportTime)
    expect(template.values).toContain(42)
  })

  test('writes null relay stamps when they are omitted (a non-relay report)', async () => {
    const query = mockDbClient()

    await setReportedResults({
      userId: USER_ID,
      gameId: GAME_ID,
      reportedResults: { time: 1000, playerResults: [] },
      reportedAt: new Date('2026-07-04T00:00:01.000Z'),
    })

    const template = query.mock.calls[0][0]
    // Both the relay stamp parameters resolve to `null` when omitted.
    const nullCount = template.values.filter((v: unknown) => v === null).length
    expect(nullCount).toBe(2)
  })
})
