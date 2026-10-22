import { afterEach, describe, expect, test, vi } from 'vitest'
import { NetcodeV2SlotEvidence } from '../../../common/games/netcode-v2'
import db from '../db'
import { insertGameSessionEvidence } from './game-session-evidence'

vi.mock('../db', () => ({ default: vi.fn() }))
afterEach(() => vi.clearAllMocks())

const SESSION = {
  gameId: '11111111-2222-4333-8444-555555555555',
  tenant: 'sb-dev',
  session: 100,
}

function entry(slot: number): NetcodeV2SlotEvidence {
  return {
    slot,
    observation: {
      connectionId: Buffer.alloc(32, slot + 1).toString('base64'),
      sequence: slot + 1,
      assignmentRevision: 3,
      verdict: 'valid',
      keyId: 42,
      body: 'AP+A',
    },
  }
}

function mockDb(status: 'stored' | 'pending' | 'ignored') {
  const query = vi.fn().mockResolvedValue({ rows: [{ status }] })
  const done = vi.fn()
  vi.mocked(db).mockResolvedValue({ client: { query } as any, done })
  return { query, done }
}

describe('models/game-session-evidence', () => {
  test('binds every inserted row to the stored session and unambiguous roster in one query', async () => {
    const { query, done } = mockDb('stored')
    expect(await insertGameSessionEvidence(SESSION, [entry(0), entry(1)])).toBe('stored')
    expect(query).toHaveBeenCalledTimes(1)
    const template = query.mock.calls[0][0]
    expect(template.text).toMatch(/FROM games WHERE id = \$\d+/)
    expect(template.text).toMatch(/WHERE game\.netcode_v2_session = \$\d+/)
    expect(template.text).toContain('GROUP BY r.slot HAVING COUNT(*) = 1')
    expect(template.text).toContain('observations o JOIN roster r ON r.slot = o.slot')
    expect(template.text).toContain('ON CONFLICT (tenant, session, slot, connection_id) DO NOTHING')
    expect(template.text).toMatch(/WHEN \(SELECT COUNT\(\*\) FROM bound\) = \$\d+ THEN 'stored'/)
    expect(template.values).toEqual([
      SESSION.gameId,
      SESSION.session,
      JSON.stringify(
        [entry(0), entry(1)].map(({ slot, observation }) => ({
          slot,
          connectionId: observation.connectionId,
          sequence: observation.sequence,
          assignmentRevision: observation.assignmentRevision,
          verdict: observation.verdict,
          keyId: observation.keyId,
          body: observation.body,
        })),
      ),
      SESSION.tenant,
      SESSION.session,
      SESSION.gameId,
      SESSION.session,
      2,
    ])
    expect(done).toHaveBeenCalledTimes(1)
  })

  test.each(['pending', 'ignored'] as const)(
    'preserves %s for unbound observations',
    async status => {
      mockDb(status)
      expect(await insertGameSessionEvidence(SESSION, [entry(0)])).toBe(status)
    },
  )

  test('releases the connection and propagates a failed write', async () => {
    const { query, done } = mockDb('stored')
    query.mockRejectedValueOnce(new Error('offline'))
    await expect(insertGameSessionEvidence(SESSION, [entry(0)])).rejects.toThrow('offline')
    expect(done).toHaveBeenCalledTimes(1)
  })
})
