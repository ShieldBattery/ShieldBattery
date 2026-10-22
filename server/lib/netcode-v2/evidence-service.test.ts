import { afterEach, describe, expect, test, vi } from 'vitest'
import { NetcodeV2EvidenceObservation } from '../../../common/games/netcode-v2'
import { insertGameSessionEvidence } from '../models/game-session-evidence'
import { EVIDENCE_OBSERVATION_SCHEMA } from './evidence-schema'
import { storeRecoveredEvidence } from './evidence-service'

vi.mock('../models/game-session-evidence', () => ({
  insertGameSessionEvidence: vi.fn().mockResolvedValue('stored'),
}))

const SESSION = {
  gameId: '11111111-2222-4333-8444-555555555555',
  tenant: 'sb-dev',
  session: 100,
}

function observation(overrides: Partial<NetcodeV2EvidenceObservation> = {}) {
  return {
    connectionId: Buffer.alloc(32, 1).toString('base64'),
    sequence: 10,
    assignmentRevision: 3,
    verdict: 'valid' as const,
    keyId: 42,
    body: Buffer.from([0, 255, 128, 1]).toString('base64'),
    ...overrides,
  }
}

afterEach(() => vi.clearAllMocks())

describe('evidence schema', () => {
  test.each(['missing', 'unknown_key', 'invalid', 'valid'] as const)(
    'accepts %s without trying to decode an application payload',
    verdict => {
      const value = observation({ verdict, body: verdict === 'valid' ? 'AP+A' : '' })
      expect(EVIDENCE_OBSERVATION_SCHEMA.validate(value).error).toBeUndefined()
    },
  )

  test.each([
    { connectionId: '' },
    { connectionId: Buffer.alloc(31).toString('base64') },
    { connectionId: Buffer.alloc(33).toString('base64') },
    { connectionId: Buffer.alloc(32).toString('base64').replace(/=$/, '') },
    { body: 'abc' },
    { body: '!!!!' },
    { body: 'AP+A\n' },
    { body: Buffer.alloc(4029).toString('base64') },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { assignmentRevision: Number.MAX_SAFE_INTEGER + 1 },
    { sequence: 0.5 },
    { keyId: 0x100000000 },
    { verdict: 'missing' as const },
    { verdict: 'invalid' as const },
    { verdict: 'unknown_key' as const },
    { keyId: undefined },
  ])('rejects malformed observation %j', overrides => {
    expect(EVIDENCE_OBSERVATION_SCHEMA.validate(observation(overrides)).error).toBeDefined()
  })

  test('accepts the exact body limit and safe integer limit', () => {
    expect(
      EVIDENCE_OBSERVATION_SCHEMA.validate(
        observation({
          body: Buffer.alloc(4028).toString('base64'),
          sequence: Number.MAX_SAFE_INTEGER,
        }),
      ).error,
    ).toBeUndefined()
  })
})

describe('storeRecoveredEvidence', () => {
  test('preserves different connections and out-of-order observations for append storage', async () => {
    const latest = { slot: 0, observation: observation() }
    const earlier = {
      slot: 0,
      observation: observation({
        connectionId: Buffer.alloc(32, 2).toString('base64'),
        sequence: 1,
      }),
    }
    await storeRecoveredEvidence(SESSION, [latest])
    await storeRecoveredEvidence(SESSION, [earlier])
    await storeRecoveredEvidence(SESSION, [latest])
    expect(insertGameSessionEvidence).toHaveBeenNthCalledWith(1, SESSION, [latest])
    expect(insertGameSessionEvidence).toHaveBeenNthCalledWith(2, SESSION, [earlier])
    expect(insertGameSessionEvidence).toHaveBeenNthCalledWith(3, SESSION, [latest])
  })

  test.each(['pending', 'ignored', 'stored'] as const)(
    'preserves the database mapping outcome %s',
    async outcome => {
      vi.mocked(insertGameSessionEvidence).mockResolvedValueOnce(outcome)
      expect(await storeRecoveredEvidence(SESSION, [{ slot: 0, observation: observation() }])).toBe(
        outcome,
      )
    },
  )

  test('does not acknowledge a failed database write', async () => {
    vi.mocked(insertGameSessionEvidence).mockRejectedValueOnce(new Error('offline'))
    await expect(
      storeRecoveredEvidence(SESSION, [{ slot: 0, observation: observation() }]),
    ).rejects.toThrow('offline')
  })

  test('rejects invalid session identifiers before reaching storage', async () => {
    for (const overrides of [
      { gameId: 'not-a-uuid' },
      { tenant: '' },
      { session: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(
        await storeRecoveredEvidence({ ...SESSION, ...overrides }, [
          { slot: 0, observation: observation() },
        ]),
      ).toBe('ignored')
    }
    expect(insertGameSessionEvidence).not.toHaveBeenCalled()
  })

  test('rejects oversized lists, invalid slots, and unverified bodies before storage', async () => {
    for (const entries of [
      Array.from({ length: 17 }, () => ({ slot: 0, observation: observation() })),
      [{ slot: 16, observation: observation() }],
      [{ slot: 0, observation: observation({ verdict: 'invalid' }) }],
    ]) {
      expect(await storeRecoveredEvidence(SESSION, entries)).toBe('ignored')
    }
    expect(insertGameSessionEvidence).not.toHaveBeenCalled()
  })

  test('does not allocate a database connection for an empty recovery result', async () => {
    expect(await storeRecoveredEvidence(SESSION, [])).toBe('stored')
    expect(insertGameSessionEvidence).not.toHaveBeenCalled()
  })
})
