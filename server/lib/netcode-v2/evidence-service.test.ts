import { afterEach, describe, expect, test, vi } from 'vitest'
import { NetcodeV2EvidenceObservation } from '../../../common/games/netcode-v2'
import log from '../logging/logger'
import { insertGameSessionEvidence } from '../models/game-session-evidence'
import { insertGameSessionPeriodicEvidence } from '../models/game-session-periodic-evidence'
import { EVIDENCE_OBSERVATION_SCHEMA } from './evidence-schema'
import { storeRecoveredEvidence } from './evidence-service'

vi.mock('../logging/logger', () => ({ default: { warn: vi.fn() } }))

vi.mock('../models/game-session-evidence', () => ({
  insertGameSessionEvidence: vi.fn().mockResolvedValue('stored'),
}))

vi.mock('../models/game-session-periodic-evidence', () => ({
  insertGameSessionPeriodicEvidence: vi.fn().mockResolvedValue('stored'),
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
    { sampleId: -1 },
    { sampleId: 0.5 },
    { sampleId: Number.MAX_SAFE_INTEGER + 1 },
    { keyId: 0x100000000 },
    { verdict: 'missing' as const },
    { verdict: 'invalid' as const },
    { verdict: 'unknown_key' as const },
    { keyId: undefined },
  ])('rejects malformed observation %j', overrides => {
    expect(EVIDENCE_OBSERVATION_SCHEMA.validate(observation(overrides)).error).toBeDefined()
  })

  test.each([
    'no_answer',
    'timeout',
    'connection_closed',
    'connection_replaced',
    'slot_departed',
    'revoked',
    'session_retired',
    'silent_slot',
    'desync_evicted',
    'lagging_slot',
    'lobby_violation',
    'stream_closed',
  ] as const)('accepts interruption %s only for missing periodic samples', interruption => {
    const missing = observation({ sampleId: 1, verdict: 'missing', body: '', interruption })
    expect(EVIDENCE_OBSERVATION_SCHEMA.validate(missing).error).toBeUndefined()
    for (const sampleId of [undefined, 0]) {
      expect(EVIDENCE_OBSERVATION_SCHEMA.validate({ ...missing, sampleId }).error).toBeDefined()
    }
    for (const verdict of ['valid', 'invalid', 'unknown_key']) {
      expect(EVIDENCE_OBSERVATION_SCHEMA.validate({ ...missing, verdict }).error).toBeDefined()
    }
    expect(
      EVIDENCE_OBSERVATION_SCHEMA.validate({ ...missing, interruption: 'unknown' }).error,
    ).toBeDefined()
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

  test('routes admission and periodic samples to independent idempotent stores', async () => {
    const admission = { slot: 0, observation: observation() }
    const later = { slot: 0, observation: observation({ sampleId: 2 }) }
    const earlier = { slot: 0, observation: observation({ sampleId: 1 }) }
    expect(await storeRecoveredEvidence(SESSION, [later, admission, earlier])).toBe('stored')
    expect(insertGameSessionEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, [admission])
    expect(insertGameSessionPeriodicEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, [
      later,
      earlier,
    ])
  })

  test('propagates a periodic storage failure after admission so the whole batch is retried', async () => {
    const entries = [
      { slot: 0, observation: observation() },
      { slot: 0, observation: observation({ sampleId: 1 }) },
    ]
    vi.mocked(insertGameSessionPeriodicEvidence).mockRejectedValueOnce(new Error('offline'))
    await expect(storeRecoveredEvidence(SESSION, entries)).rejects.toThrow('offline')
    expect(await storeRecoveredEvidence(SESSION, entries)).toBe('stored')
    expect(insertGameSessionEvidence).toHaveBeenCalledTimes(2)
    expect(insertGameSessionPeriodicEvidence).toHaveBeenCalledTimes(2)
  })

  test('stores a full roster with retained failures from earlier connections', async () => {
    const admissions = Array.from({ length: 16 }, (_, slot) => ({
      slot,
      observation: observation(),
    }))
    const periodic = admissions.map(({ slot }) => ({
      slot,
      observation: observation({ sampleId: 1 }),
    }))
    const failures = admissions.map(({ slot }) => ({
      slot,
      observation: observation({
        connectionId: Buffer.alloc(32, 2).toString('base64'),
        sampleId: 1,
        sequence: 2,
        verdict: 'missing',
        body: '',
      }),
    }))
    const latestFailures = failures.map(entry => ({
      ...entry,
      historical: true,
      failureCount: 4,
      observation: {
        ...entry.observation,
        sampleId: 4,
        sequence: 5,
        interruption: 'timeout' as const,
      },
    }))
    expect(
      await storeRecoveredEvidence(SESSION, [
        ...admissions,
        ...periodic,
        ...failures,
        ...latestFailures,
      ]),
    ).toBe('stored')
    expect(insertGameSessionEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, admissions)
    expect(insertGameSessionPeriodicEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, [
      ...periodic,
      ...failures,
      ...latestFailures,
    ])
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
      Array.from({ length: 129 }, () => ({ slot: 0, observation: observation() })),
      [{ slot: 16, observation: observation() }],
      [{ slot: 0, observation: observation({ verdict: 'invalid' }) }],
    ]) {
      expect(await storeRecoveredEvidence(SESSION, entries)).toBe('ignored')
    }
    expect(insertGameSessionEvidence).not.toHaveBeenCalled()
  })

  test('preserves cumulative history metadata without summing repeated or out-of-order entries', async () => {
    const first = {
      slot: 0,
      historical: true,
      failureCount: 9,
      observation: observation({
        sampleId: 1,
        verdict: 'missing',
        body: '',
        interruption: 'connection_replaced',
      }),
    }
    const latest = { ...first, observation: { ...first.observation, sampleId: 9 } }
    for (const entries of [[first, latest], [{ ...first, failureCount: 2 }], [latest, first]]) {
      expect(await storeRecoveredEvidence(SESSION, entries)).toBe('stored')
      expect(insertGameSessionPeriodicEvidence).toHaveBeenLastCalledWith(SESSION, entries)
    }
  })

  test('rejects malformed or inconsistent history metadata', async () => {
    const first = {
      slot: 0,
      historical: true,
      failureCount: 9,
      observation: observation({
        sampleId: 1,
        verdict: 'missing',
        body: '',
        interruption: 'timeout',
      }),
    }
    for (const overrides of [
      { failureCount: 0 },
      { failureCount: -1 },
      { failureCount: 1.5 },
      { failureCount: 0x100000000 },
      { historical: false },
      { observation: observation({ sampleId: 1 }) },
      { observation: { ...first.observation, sampleId: 0 } },
      { observation: { ...first.observation, interruption: 'revoked' as const } },
      { observation: { ...first.observation, interruption: 'session_retired' as const } },
    ]) {
      expect(await storeRecoveredEvidence(SESSION, [{ ...first, ...overrides }])).toBe('ignored')
    }
    expect(insertGameSessionPeriodicEvidence).not.toHaveBeenCalled()
  })

  test('skips malformed and future samples while preserving independent observations', async () => {
    const admission = { slot: 0, observation: observation() }
    const history = {
      slot: 0,
      observedAtMs: 123,
      historical: true,
      failureCount: 4,
      observation: observation({
        sampleId: 3,
        verdict: 'missing',
        body: '',
        interruption: 'timeout',
      }),
    }
    const future = {
      ...history,
      observation: { ...history.observation, interruption: 'future_reason' },
    }
    expect(await storeRecoveredEvidence(SESSION, [null, {}, future, admission, history])).toBe(
      'stored',
    )
    expect(insertGameSessionEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, [admission])
    expect(insertGameSessionPeriodicEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, [history])
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      { ignored: 3 },
      'Ignoring unsupported or malformed coordinator observations',
    )
  })

  test('accepts bounded response growth beyond the current four records per slot', async () => {
    const entries = Array.from({ length: 128 }, (_, i) => ({
      slot: i % 16,
      observation: observation({ sampleId: i + 1 }),
    }))
    expect(await storeRecoveredEvidence(SESSION, entries)).toBe('stored')
    expect(insertGameSessionPeriodicEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, entries)
  })

  test('preserves observation time and leaves legacy timestamps unknown', async () => {
    const old = { slot: 0, observation: observation({ sampleId: 1 }) }
    const recent = { ...old, observedAtMs: 123, observation: observation({ sampleId: 2 }) }
    const limits = { ...old, observedAtMs: 8_640_000_000_000_000 }
    expect(await storeRecoveredEvidence(SESSION, [old, recent, limits])).toBe('stored')
    expect(insertGameSessionPeriodicEvidence).toHaveBeenCalledExactlyOnceWith(SESSION, [
      old,
      recent,
      limits,
    ])
  })

  test.each([NaN, Infinity, -1, 1.5, '123', 8_640_000_000_000_001])(
    'drops an invalid observation timestamp %s',
    async observedAtMs => {
      expect(
        await storeRecoveredEvidence(SESSION, [
          { slot: 0, observedAtMs, observation: observation({ sampleId: 1 }) },
        ]),
      ).toBe('ignored')
      expect(insertGameSessionPeriodicEvidence).not.toHaveBeenCalled()
    },
  )

  test('does not allocate a database connection for an empty recovery result', async () => {
    expect(await storeRecoveredEvidence(SESSION, [])).toBe('stored')
    expect(insertGameSessionEvidence).not.toHaveBeenCalled()
  })
})
