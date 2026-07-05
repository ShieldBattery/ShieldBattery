import { describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import db from '../db'
import {
  findKnownCompleteUnreconciledGames,
  findUnreconciledGames,
  findUnreconciledV2GamesForProbe,
  setNetcodeV2Session,
} from './game-models'

vi.mock('../db', () => ({
  default: vi.fn(),
}))

/** Stubs `db()` to hand back a fake client whose `query` calls are captured for assertions. */
function mockDbClient(rows: Array<Record<string, unknown>>) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length })
  const done = vi.fn()
  asMockedFunction(db).mockResolvedValue({ client: { query } as any, done })
  return query
}

describe('games/game-models/findKnownCompleteUnreconciledGames', () => {
  test('returns the game ids from the query result', async () => {
    mockDbClient([{ id: 'game-1' }, { id: 'game-2' }])
    const olderThan = new Date('2026-07-04T00:00:00.000Z')

    const result = await findKnownCompleteUnreconciledGames(olderThan)

    expect(result).toEqual(['game-1', 'game-2'])
  })

  test('queries games_users/games filtered on unreconciled netcode-v2 games and the cutoff time', async () => {
    const query = mockDbClient([])
    const olderThan = new Date('2026-07-04T00:00:00.000Z')

    await findKnownCompleteUnreconciledGames(olderThan)

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('g.results IS NULL')
    expect(template.text).toContain("(g.config->>'useNetcodeV2')::boolean IS TRUE")
    expect(template.text).toContain(
      'bool_and(gu.reported_results IS NOT NULL OR gu.departure_kind IS NOT NULL)',
    )
    expect(template.values).toContain(olderThan)
  })
})

describe('games/game-models/findUnreconciledGames', () => {
  test('returns the game ids from the query result', async () => {
    mockDbClient([{ id: 'game-1' }, { id: 'game-2' }])
    const reportedBefore = new Date('2026-07-04T00:00:00.000Z')

    const result = await findUnreconciledGames(reportedBefore)

    expect(result).toEqual(['game-1', 'game-2'])
  })

  test('excludes games with a persisted netcode-v2 session id', async () => {
    const query = mockDbClient([])
    const reportedBefore = new Date('2026-07-04T00:00:00.000Z')

    await findUnreconciledGames(reportedBefore)

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('g.netcode_v2_session IS NULL')
    expect(template.values).toContain(reportedBefore)
  })
})

describe('games/game-models/findUnreconciledV2GamesForProbe', () => {
  test('returns gameId/session pairs, normalizing the BIGINT session id to a number', async () => {
    mockDbClient([
      // eslint-disable-next-line camelcase
      { id: 'game-1', netcode_v2_session: '1234567890123' },
      // eslint-disable-next-line camelcase
      { id: 'game-2', netcode_v2_session: '42' },
    ])
    const olderThan = new Date('2026-07-04T00:00:00.000Z')

    const result = await findUnreconciledV2GamesForProbe(olderThan)

    expect(result).toEqual([
      { gameId: 'game-1', session: 1234567890123 },
      { gameId: 'game-2', session: 42 },
    ])
  })

  test('queries games filtered on unreconciled v2 games with a session id and the cutoff time', async () => {
    const query = mockDbClient([])
    const olderThan = new Date('2026-07-04T00:00:00.000Z')

    await findUnreconciledV2GamesForProbe(olderThan)

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('results IS NULL')
    expect(template.text).toContain('netcode_v2_session IS NOT NULL')
    expect(template.text).toContain('start_time <')
    expect(template.values).toContain(olderThan)
  })
})

describe('games/game-models/setNetcodeV2Session', () => {
  test('updates the game row with the given session id', async () => {
    const query = mockDbClient([])

    await setNetcodeV2Session('game-1', 1234567890123)

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('UPDATE games')
    expect(template.text).toContain('SET')
    expect(template.text).toContain('netcode_v2_session')
    expect(template.values).toEqual([1234567890123, 'game-1'])
  })
})
