import { describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import db from '../db'
import { findKnownCompleteUnreconciledGames } from './game-models'

vi.mock('../db', () => ({
  default: vi.fn(),
}))

/** Stubs `db()` to hand back a fake client whose `query` calls are captured for assertions. */
function mockDbClient(rows: Array<{ id: string }>) {
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
