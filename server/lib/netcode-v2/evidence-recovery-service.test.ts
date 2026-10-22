import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { findNetcodeV2EvidenceRecoveryCandidates } from '../games/game-models'
import { JobScheduler } from '../jobs/job-scheduler'
import { EvidenceRecoveryService } from './evidence-recovery-service'
import { storeRecoveredEvidence } from './evidence-service'
import { checkSessionsAlive, NetcodeV2Service } from './netcode-v2-service'

vi.mock('../games/game-models', () => ({ findNetcodeV2EvidenceRecoveryCandidates: vi.fn() }))
vi.mock('./evidence-service', () => ({ storeRecoveredEvidence: vi.fn() }))
vi.mock('./netcode-v2-service', async importOriginal => ({
  ...(await importOriginal<typeof import('./netcode-v2-service')>()),
  checkSessionsAlive: vi.fn(),
}))

const OBSERVATIONS = [
  {
    slot: 0,
    observation: {
      connectionId: Buffer.alloc(32, 1).toString('base64'),
      sequence: 1,
      assignmentRevision: 1,
      verdict: 'valid' as const,
      keyId: 17,
      body: Buffer.from('opaque').toString('base64'),
    },
  },
]

function candidates(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    gameId: `game-${offset + index}`,
    session: offset + index,
  }))
}

function setup() {
  const scheduleImmediateJob = vi.fn()
  const fetchSessionEvidence = vi.fn().mockResolvedValue(OBSERVATIONS)
  const service = new EvidenceRecoveryService(
    { scheduleImmediateJob } as unknown as JobScheduler,
    { fetchSessionEvidence } as unknown as NetcodeV2Service,
  )
  return { service, scheduleImmediateJob, fetchSessionEvidence }
}

describe('EvidenceRecoveryService', () => {
  beforeEach(() => {
    vi.stubEnv('SB_RP2_COORDINATOR_URL', 'http://coordinator.example')
    vi.stubEnv('SB_RP2_TENANT', 'sb-dev')
    vi.stubEnv('SB_RP2_CLIENT_KEY', '11'.repeat(32))
    vi.stubEnv('SB_RP2_EVIDENCE_KEYS', JSON.stringify([{ keyId: 17, publicKey: 'ab'.repeat(32) }]))
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue([])
    asMockedFunction(storeRecoveredEvidence).mockResolvedValue('stored')
    asMockedFunction(checkSessionsAlive).mockImplementation(async sessions => new Set(sessions))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetAllMocks()
  })

  test.each([undefined, '[]'])('does not schedule or fetch without keys: %s', async keys => {
    vi.stubEnv('SB_RP2_EVIDENCE_KEYS', keys)
    const { service, scheduleImmediateJob, fetchSessionEvidence } = setup()
    await service.recover()
    expect(scheduleImmediateJob).not.toHaveBeenCalled()
    expect(findNetcodeV2EvidenceRecoveryCandidates).not.toHaveBeenCalled()
    expect(fetchSessionEvidence).not.toHaveBeenCalled()
    expect(checkSessionsAlive).not.toHaveBeenCalled()
  })

  test('schedules recovery and stores positive observations without settling the lobby', async () => {
    const [candidate] = candidates(1)
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue([candidate])
    const { scheduleImmediateJob, fetchSessionEvidence } = setup()
    expect(scheduleImmediateJob).toHaveBeenCalledWith(
      'lib/netcode-v2#recoverEvidence',
      30_000,
      expect.any(Function),
    )
    await scheduleImmediateJob.mock.calls[0][2]()
    expect(fetchSessionEvidence).toHaveBeenCalledWith(candidate.session, { timeoutMs: 6000 })
    expect(storeRecoveredEvidence).toHaveBeenCalledWith(
      { gameId: candidate.gameId, tenant: 'sb-dev', session: candidate.session },
      OBSERVATIONS,
    )
  })

  test('advances bounded pages and wraps after reaching the end', async () => {
    const first = candidates(100)
    const second = candidates(2, 100)
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce([])
    const { service, fetchSessionEvidence } = setup()
    fetchSessionEvidence.mockResolvedValue([])
    await service.recover()
    await service.recover()
    await service.recover()
    const args = asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mock.calls.map(c => c[0])
    expect(args[0]).toMatchObject({ after: undefined, limit: 100, since: expect.any(Date) })
    expect(args[1]).toMatchObject({
      after: { gameId: first[99].gameId },
      limit: 100,
    })
    expect(args[2].after).toBeUndefined()
    expect(fetchSessionEvidence).toHaveBeenCalledTimes(102)
    expect(storeRecoveredEvidence).not.toHaveBeenCalled()
  })

  test('caps concurrency and joins overlapping sweeps', async () => {
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue(candidates(7))
    const { service, fetchSessionEvidence } = setup()
    let release!: () => void
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    let active = 0
    let maxActive = 0
    fetchSessionEvidence.mockImplementation(async () => {
      ++active
      maxActive = Math.max(maxActive, active)
      await pending
      --active
      return []
    })
    const first = service.recover()
    const overlapping = service.recover()
    await vi.waitFor(() => expect(fetchSessionEvidence).toHaveBeenCalledTimes(4))
    expect(findNetcodeV2EvidenceRecoveryCandidates).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, overlapping])
    expect(fetchSessionEvidence).toHaveBeenCalledTimes(7)
    expect(maxActive).toBe(4)
  })

  test('probes a page once and fetches observations only for live sessions', async () => {
    const page = candidates(100)
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue(page)
    asMockedFunction(checkSessionsAlive).mockResolvedValue(new Set([42, 99]))
    const { service, fetchSessionEvidence } = setup()
    await service.recover()
    expect(checkSessionsAlive).toHaveBeenCalledExactlyOnceWith(page.map(c => c.session))
    expect(fetchSessionEvidence.mock.calls.map(c => c[0])).toEqual([42, 99])
    expect(storeRecoveredEvidence).toHaveBeenCalledTimes(2)
  })

  test('advances past a page of finished games without fetching evidence', async () => {
    const finished = candidates(100)
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates)
      .mockResolvedValueOnce(finished)
      .mockResolvedValueOnce(candidates(1, 100))
      .mockResolvedValueOnce([])
    asMockedFunction(checkSessionsAlive)
      .mockResolvedValueOnce(new Set())
      .mockResolvedValueOnce(new Set([100]))
    const { service, fetchSessionEvidence } = setup()
    await service.recover()
    expect(fetchSessionEvidence).not.toHaveBeenCalled()
    await service.recover()
    expect(fetchSessionEvidence).toHaveBeenCalledExactlyOnceWith(100, { timeoutMs: 6000 })
    expect(
      asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mock.calls[1][0].after,
    ).toEqual({
      gameId: finished[99].gameId,
    })
    await service.recover()
    expect(checkSessionsAlive).toHaveBeenCalledTimes(2)
  })

  test('a failed liveness probe preserves the page for retry and makes no individual reads', async () => {
    const page = candidates(100)
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue(page)
    asMockedFunction(checkSessionsAlive).mockRejectedValueOnce(new Error('unreachable'))
    const { service, fetchSessionEvidence } = setup()
    await expect(service.recover()).rejects.toThrow('unreachable')
    expect(fetchSessionEvidence).not.toHaveBeenCalled()
    await service.recover()
    expect(fetchSessionEvidence).toHaveBeenCalledTimes(100)
    const queries = asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mock.calls
    expect(queries[1][0].after).toEqual(queries[0][0].after)
  })

  test('a session closing after the probe returns no observation to store', async () => {
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue(candidates(1))
    const { service, fetchSessionEvidence } = setup()
    fetchSessionEvidence.mockResolvedValue([])
    await service.recover()
    expect(fetchSessionEvidence).toHaveBeenCalledExactlyOnceWith(0, { timeoutMs: 6000 })
    expect(storeRecoveredEvidence).not.toHaveBeenCalled()
  })

  test('isolates session and storage failures so other records still recover', async () => {
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue(candidates(3))
    const { service, fetchSessionEvidence } = setup()
    fetchSessionEvidence.mockRejectedValueOnce(new Error('unreachable'))
    asMockedFunction(storeRecoveredEvidence).mockRejectedValueOnce(
      new Error('database unavailable'),
    )
    await service.recover()
    expect(fetchSessionEvidence).toHaveBeenCalledTimes(3)
    expect(storeRecoveredEvidence).toHaveBeenCalledTimes(2)
  })

  test('an older coordinator stops the page and retries on the next sweep without load-state fallback', async () => {
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mockResolvedValue(candidates(100))
    const { service, fetchSessionEvidence } = setup()
    fetchSessionEvidence.mockResolvedValue(undefined)
    await service.recover()
    expect(fetchSessionEvidence).toHaveBeenCalledTimes(4)
    expect(storeRecoveredEvidence).not.toHaveBeenCalled()
    fetchSessionEvidence.mockResolvedValue([])
    await service.recover()
    expect(fetchSessionEvidence).toHaveBeenCalledTimes(104)
    const args = asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mock.calls.map(c => c[0])
    expect(args[1].after).toEqual(args[0].after)
  })

  test('failed requests still advance a full page so a failing session cannot starve later ones', async () => {
    const first = candidates(100)
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(candidates(1, 100))
    const { service, fetchSessionEvidence } = setup()
    fetchSessionEvidence.mockRejectedValue(new Error('unavailable'))
    await service.recover()
    fetchSessionEvidence.mockResolvedValue(OBSERVATIONS)
    await service.recover()
    expect(
      asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mock.calls[1][0].after,
    ).toEqual({ gameId: first[99].gameId })
    expect(storeRecoveredEvidence).toHaveBeenCalledTimes(1)
  })

  test('query failure releases the sweep guard and preserves the pagination cursor', async () => {
    const first = candidates(100)
    asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([])
    const { service, fetchSessionEvidence } = setup()
    fetchSessionEvidence.mockResolvedValue([])
    await service.recover()
    await expect(service.recover()).rejects.toThrow('database unavailable')
    await service.recover()
    const args = asMockedFunction(findNetcodeV2EvidenceRecoveryCandidates).mock.calls.map(c => c[0])
    expect(args[2].after).toEqual(args[1].after)
  })
})
