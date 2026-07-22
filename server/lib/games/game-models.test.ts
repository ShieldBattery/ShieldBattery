import { describe, expect, test, vi } from 'vitest'
import { NetcodeV2RelayEvent } from '../../../common/games/netcode-v2'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import {
  addNetcodeV2RelayEvents,
  findFullyReportedUnreconciledGames,
  findKnownCompleteUnreconciledGames,
  findUnreconciledGames,
  findUnreconciledV2GamesForProbe,
  getGames,
  getGamesForUser,
  getNetcodeV2DebugInfo,
  getRecentGamesForUser,
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
    expect(template.text).toContain("(g.config->>'resultsExempt')::boolean IS NOT TRUE")
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
    expect(template.text).toContain("(g.config->>'resultsExempt')::boolean IS NOT TRUE")
    expect(template.values).toContain(reportedBefore)
  })
})

describe('games/game-models/findFullyReportedUnreconciledGames', () => {
  test('returns the game ids from the query result', async () => {
    mockDbClient([{ id: 'game-1' }, { id: 'game-2' }])
    const reportedBefore = new Date('2026-07-04T00:00:00.000Z')

    const result = await findFullyReportedUnreconciledGames(reportedBefore)

    expect(result).toEqual(['game-1', 'game-2'])
  })

  test('excludes results-exempt games', async () => {
    const query = mockDbClient([])
    const reportedBefore = new Date('2026-07-04T00:00:00.000Z')

    await findFullyReportedUnreconciledGames(reportedBefore)

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('g.results IS NULL')
    expect(template.text).toContain("(g.config->>'resultsExempt')::boolean IS NOT TRUE")
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
    expect(template.text).toContain("(config->>'resultsExempt')::boolean IS NOT TRUE")
    expect(template.values).toContain(olderThan)
  })
})

describe('games/game-models/getGames', () => {
  test('excludes results-exempt games from the platform games list', async () => {
    const query = mockDbClient([])

    await getGames({ limit: 10, offset: 0 })

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain("(g.config->>'resultsExempt')::boolean IS NOT TRUE")
  })

  test('omits the start_time bounds when startDate/endDate are not given', async () => {
    const query = mockDbClient([])

    await getGames({ limit: 10, offset: 0 })

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).not.toContain('g.start_time >=')
    expect(template.text).not.toContain('g.start_time <=')
  })

  test('filters on start_time when startDate/endDate are given', async () => {
    const query = mockDbClient([])
    const startDate = Date.parse('2026-07-01T00:00:00.000Z')
    const endDate = Date.parse('2026-07-21T23:59:59.999Z')

    await getGames({ limit: 10, offset: 0, startDate, endDate })

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('g.start_time >=')
    expect(template.text).toContain('g.start_time <=')
    expect(template.values).toContainEqual(new Date(startDate))
    expect(template.values).toContainEqual(new Date(endDate))
  })
})

describe('games/game-models/getGamesForUser', () => {
  test('excludes results-exempt games from a user match history', async () => {
    const query = mockDbClient([])
    const userId = makeSbUserId(1)

    await getGamesForUser({ userId, limit: 10, offset: 0 })

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain("(g.config->>'resultsExempt')::boolean IS NOT TRUE")
  })

  test('omits the start_time bounds when startDate/endDate are not given', async () => {
    const query = mockDbClient([])
    const userId = makeSbUserId(1)

    await getGamesForUser({ userId, limit: 10, offset: 0 })

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).not.toContain('g.start_time >=')
    expect(template.text).not.toContain('g.start_time <=')
  })

  test('filters on start_time when startDate/endDate are given', async () => {
    const query = mockDbClient([])
    const userId = makeSbUserId(1)
    const startDate = Date.parse('2026-07-01T00:00:00.000Z')
    const endDate = Date.parse('2026-07-21T23:59:59.999Z')

    await getGamesForUser({ userId, limit: 10, offset: 0, startDate, endDate })

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('g.start_time >=')
    expect(template.text).toContain('g.start_time <=')
    expect(template.values).toContainEqual(new Date(startDate))
    expect(template.values).toContainEqual(new Date(endDate))
  })
})

describe('games/game-models/getRecentGamesForUser', () => {
  test('excludes results-exempt games from a user profile recent-games list', async () => {
    const query = mockDbClient([])
    const userId = makeSbUserId(1)

    await getRecentGamesForUser(userId, 6)

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain("(g.config->>'resultsExempt')::boolean IS NOT TRUE")
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

describe('games/game-models/addNetcodeV2RelayEvents', () => {
  test('appends the events as a jsonb array onto the (possibly-null) existing history', async () => {
    const query = mockDbClient([])
    const events: NetcodeV2RelayEvent[] = [
      { kind: 'home', relayId: 1, relayAddr: '10.0.0.1:14900', at: 1000 },
    ]

    await addNetcodeV2RelayEvents('game-1', events)

    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toContain('UPDATE games')
    expect(template.text).toContain("COALESCE(netcode_v2_relays, '[]'::jsonb)")
    expect(template.text).toContain('||')
    expect(template.values).toEqual([JSON.stringify(events), 'game-1'])
  })

  test('is a no-op for an empty event list', async () => {
    const query = mockDbClient([])

    await addNetcodeV2RelayEvents('game-1', [])

    expect(query).not.toHaveBeenCalled()
  })
})

describe('games/game-models/getNetcodeV2DebugInfo', () => {
  test('normalizes the BIGINT session id and returns the relay history', async () => {
    const relays: NetcodeV2RelayEvent[] = [
      { kind: 'home', relayId: 1, relayAddr: '10.0.0.1:14900', at: 1000 },
    ]
    // eslint-disable-next-line camelcase
    mockDbClient([{ netcode_v2_session: '1234567890123', netcode_v2_relays: relays }])

    const result = await getNetcodeV2DebugInfo('game-1')

    expect(result).toEqual({ session: 1234567890123, relays })
  })

  test('returns a null session and empty relay list for a game with no netcode-v2 history', async () => {
    // eslint-disable-next-line camelcase
    mockDbClient([{ netcode_v2_session: null, netcode_v2_relays: null }])

    const result = await getNetcodeV2DebugInfo('game-1')

    expect(result).toEqual({ session: null, relays: [] })
  })
})
