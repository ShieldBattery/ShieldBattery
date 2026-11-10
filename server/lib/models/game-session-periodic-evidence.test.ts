import { afterEach, describe, expect, test, vi } from 'vitest'
import { withDbClient } from '../db'
import { deleteExpiredGameSessionPeriodicEvidence } from './game-session-periodic-evidence'

vi.mock('../db', () => ({ default: vi.fn(), withDbClient: vi.fn() }))
afterEach(() => vi.clearAllMocks())

describe('models/game-session-periodic-evidence', () => {
  test('deletes one locked, bounded batch of rows received before the cutoff by primary key', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    vi.mocked(withDbClient).mockImplementation(fn => fn({ query } as any))
    const before = new Date(Date.UTC(2026, 9, 17))
    await deleteExpiredGameSessionPeriodicEvidence(before)
    expect(query).toHaveBeenCalledTimes(1)
    const { text, values } = query.mock.calls[0][0]
    expect(values).toEqual([before])
    expect(text).toContain('LIMIT 1000')
    expect(text).toContain('FOR UPDATE SKIP LOCKED')
    expect(text).toContain('game_session_periodic_evidence.sample_id = expired.sample_id')
  })
})
