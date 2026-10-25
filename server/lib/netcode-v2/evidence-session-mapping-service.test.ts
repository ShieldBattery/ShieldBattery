import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { setNetcodeV2SessionMapping } from '../games/game-models'
import { JobScheduler } from '../jobs/job-scheduler'
import { monotonicNow } from '../time/monotonic-now'
import { EvidenceSessionMappingService } from './evidence-session-mapping-service'

vi.mock('../games/game-models', () => ({ setNetcodeV2SessionMapping: vi.fn() }))
vi.mock('../time/monotonic-now', () => ({ monotonicNow: vi.fn() }))
vi.mock('../logging/logger', () => ({ default: { warn: vi.fn() } }))

const ROSTER = [{ slot: 0, userId: makeSbUserId(42), observer: false }]

function setup() {
  const scheduleImmediateJob = vi.fn()
  const service = new EvidenceSessionMappingService({
    scheduleImmediateJob,
  } as unknown as JobScheduler)
  const retry = scheduleImmediateJob.mock.calls[0][2] as () => Promise<void>
  return { service, retry }
}

describe('EvidenceSessionMappingService', () => {
  beforeEach(() => {
    vi.mocked(monotonicNow).mockReturnValue(0)
    vi.mocked(setNetcodeV2SessionMapping).mockResolvedValue(true)
  })
  afterEach(() => vi.resetAllMocks())

  test('writes the entire mapping once and does not retry success', async () => {
    const { service, retry } = setup()
    await service.persist('game-1', 100, ROSTER)
    await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledExactlyOnceWith('game-1', 100, ROSTER)
  })

  test('returns after an initial failure, then repairs the full mapping after database recovery', async () => {
    vi.mocked(setNetcodeV2SessionMapping)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
    const { service, retry } = setup()
    await expect(service.persist('game-1', 100, ROSTER)).resolves.toBeUndefined()
    await retry()
    await retry()
    await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(3)
    expect(setNetcodeV2SessionMapping).toHaveBeenLastCalledWith('game-1', 100, ROSTER)
  })

  test('retains development mode through a delayed mapping repair', async () => {
    vi.mocked(setNetcodeV2SessionMapping).mockRejectedValueOnce(new Error('offline'))
    const { service, retry } = setup()
    const roster = [{ ...ROSTER[0], developmentClient: true }]
    await service.persist('game-development', 100, roster)
    roster[0].developmentClient = false
    await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenLastCalledWith('game-development', 100, [
      { ...ROSTER[0], developmentClient: true },
    ])
  })

  test('drops a mapping refused because its game is gone or bound to another session', async () => {
    vi.mocked(setNetcodeV2SessionMapping).mockResolvedValue(false)
    const { service, retry } = setup()
    await expect(service.persist('game-1', 100, ROSTER)).resolves.toBeUndefined()
    await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(1)
  })

  test('expires failed records by elapsed time without retrying indefinitely', async () => {
    vi.mocked(setNetcodeV2SessionMapping).mockRejectedValue(new Error('offline'))
    const { service, retry } = setup()
    await service.persist('game-1', 100, ROSTER)
    vi.mocked(monotonicNow).mockReturnValue(15 * 60 * 1000)
    await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(1)
  })

  test('coalesces identical concurrent creates', async () => {
    let resolve!: (value: boolean) => void
    vi.mocked(setNetcodeV2SessionMapping).mockReturnValueOnce(
      new Promise<boolean>(r => {
        resolve = r
      }),
    )
    const { service } = setup()
    const first = service.persist('game-1', 100, ROSTER)
    const second = service.persist('game-1', 100, ROSTER)
    await Promise.resolve()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(1)
    resolve(true)
    await Promise.all([first, second])
  })

  test('serializes a replacement after an in-flight write and retains it if its write fails', async () => {
    let resolve!: (value: boolean) => void
    vi.mocked(setNetcodeV2SessionMapping)
      .mockReturnValueOnce(
        new Promise<boolean>(r => {
          resolve = r
        }),
      )
      .mockRejectedValueOnce(new Error('offline'))
    const { service, retry } = setup()
    const first = service.persist('game-1', 100, ROSTER)
    await Promise.resolve()
    const replacement = [{ ...ROSTER[0], rttMs: 50 }]
    const second = service.persist('game-1', 100, replacement)
    await Promise.resolve()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(1)
    resolve(true)
    await Promise.all([first, second])
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(2)
    await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenLastCalledWith('game-1', 100, replacement)
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(3)
  })

  test('rotates failures so later mappings get attempts within bounded batches', async () => {
    vi.mocked(setNetcodeV2SessionMapping).mockRejectedValue(new Error('offline'))
    const { service, retry } = setup()
    for (let i = 0; i < 32; i++) await service.persist(`game-${i}`, 100 + i, ROSTER)
    vi.mocked(setNetcodeV2SessionMapping).mockClear()
    await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(16)
    expect(vi.mocked(setNetcodeV2SessionMapping).mock.calls.map(c => c[0])).toEqual(
      Array.from({ length: 16 }, (_, i) => `game-${i}`),
    )
    vi.mocked(setNetcodeV2SessionMapping).mockClear()
    await retry()
    expect(vi.mocked(setNetcodeV2SessionMapping).mock.calls.map(c => c[0])).toEqual(
      Array.from({ length: 16 }, (_, i) => `game-${i + 16}`),
    )
  })

  test('caps retained failures while still attempting the normal write for an overflow', async () => {
    vi.mocked(setNetcodeV2SessionMapping).mockRejectedValue(new Error('offline'))
    const { service, retry } = setup()
    for (let i = 0; i < 513; i++) await service.persist(`game-${i}`, 100 + i, ROSTER)
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(513)
    vi.mocked(setNetcodeV2SessionMapping).mockClear().mockResolvedValue(true)
    for (let i = 0; i < 33; i++) await retry()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(512)
    expect(setNetcodeV2SessionMapping).not.toHaveBeenCalledWith('game-512', 612, ROSTER)
  })

  test('limits retry concurrency and shares overlapping scheduler runs', async () => {
    vi.mocked(setNetcodeV2SessionMapping).mockRejectedValue(new Error('offline'))
    const { service, retry } = setup()
    for (let i = 0; i < 4; i++) await service.persist(`game-${i}`, 100 + i, ROSTER)
    let release!: () => void
    const wait = new Promise<void>(resolve => {
      release = resolve
    })
    let active = 0
    let maxActive = 0
    vi.mocked(setNetcodeV2SessionMapping)
      .mockClear()
      .mockImplementation(async () => {
        maxActive = Math.max(maxActive, ++active)
        await wait
        --active
        return true
      })
    const first = retry()
    const overlapping = retry()
    await Promise.resolve()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(2)
    release()
    await Promise.all([first, overlapping])
    expect(maxActive).toBe(2)
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(4)
  })

  test('skips a queued candidate whose idempotent create started a write during the batch', async () => {
    vi.mocked(setNetcodeV2SessionMapping).mockRejectedValue(new Error('offline'))
    const { service, retry } = setup()
    for (let i = 0; i < 4; i++) await service.persist(`game-${i}`, 100 + i, ROSTER)
    const release = new Map<string, (value: boolean) => void>()
    vi.mocked(setNetcodeV2SessionMapping)
      .mockClear()
      .mockImplementation(gameId => new Promise<boolean>(resolve => release.set(gameId, resolve)))
    const batch = retry()
    await Promise.resolve()
    expect(setNetcodeV2SessionMapping).toHaveBeenCalledTimes(2)
    const create = service.persist('game-2', 102, ROSTER)
    await Promise.resolve()
    expect(release.has('game-2')).toBe(true)
    release.get('game-0')!(true)
    await vi.waitFor(() => expect(release.has('game-3')).toBe(true))
    expect(
      vi.mocked(setNetcodeV2SessionMapping).mock.calls.filter(c => c[0] === 'game-2'),
    ).toHaveLength(1)
    for (const resolve of release.values()) resolve(true)
    await Promise.all([batch, create])
  })
})
