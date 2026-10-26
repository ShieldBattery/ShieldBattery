import { EventEmitter } from 'node:events'
import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, Mock, test, vi } from 'vitest'
import {
  makeSeasonId,
  MatchmakingSeason,
  MatchmakingSeasonsEvent,
  MatchmakingType,
} from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { JobScheduler } from '../jobs/job-scheduler'
import { FakeClock } from '../time/testing/fake-clock'
import { ClientSocketsGroup, ClientSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { MATCHMAKING_SEASONS_PATH, MatchmakingSeasonsService } from './matchmaking-seasons'
import {
  addMatchmakingSeason,
  deleteMatchmakingSeason,
  getMatchmakingSeasons,
  getRatingDifferencesFromReference,
  setMatchmakingSeasonDivisionRatingOffsets,
} from './models'

vi.mock('./models', () => ({
  getMatchmakingSeasons: vi.fn(),
  addMatchmakingSeason: vi.fn(),
  deleteMatchmakingSeason: vi.fn(),
  getRatingDifferencesFromReference: vi.fn(),
  setMatchmakingSeasonDivisionRatingOffsets: vi.fn(),
}))
vi.mock('../logging/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }))

const getMatchmakingSeasonsMock = asMockedFunction(getMatchmakingSeasons)
const addMatchmakingSeasonMock = asMockedFunction(addMatchmakingSeason)
const deleteMatchmakingSeasonMock = asMockedFunction(deleteMatchmakingSeason)
const getRatingDifferencesFromReferenceMock = asMockedFunction(getRatingDifferencesFromReference)
const setMatchmakingSeasonDivisionRatingOffsetsMock = asMockedFunction(
  setMatchmakingSeasonDivisionRatingOffsets,
)

const OFFSETS_JOB_ID = 'lib/matchmaking#seasonDivisionRatingOffsets'
const RETRY_JOB_ID = 'lib/matchmaking#seasonDivisionRatingOffsetsRetry'
const SYNC_RETRY_JOB_ID = 'lib/matchmaking#seasonDivisionRatingOffsetsSyncRetry'

const STARTING_SEASONS: ReadonlyArray<MatchmakingSeason> = [
  {
    id: makeSeasonId(3),
    startDate: new Date('2023-01-01'),
    name: 'Cooler Season',
    resetMmr: false,
  },
  {
    id: makeSeasonId(2),
    startDate: new Date('2022-06-01'),
    name: 'Cool Season',
    resetMmr: true,
  },
  {
    id: makeSeasonId(1),
    startDate: new Date('2012-01-01'),
    name: 'Beta Season',
    resetMmr: true,
  },
]

describe('matchmaking/matchmaking-seasons', () => {
  let clock: FakeClock
  let jobScheduler: { scheduleJob: Mock; unscheduleJob: Mock }
  let service: MatchmakingSeasonsService
  let mockDbState: MatchmakingSeason[]
  let nydus: { publish: Mock }
  let clientSocketsManager: EventEmitter

  function createService() {
    return new MatchmakingSeasonsService(
      clock,
      jobScheduler as unknown as JobScheduler,
      new TypedPublisher<MatchmakingSeasonsEvent>(nydus as unknown as NydusServer),
      clientSocketsManager as unknown as ClientSocketsManager,
    )
  }

  function scheduledJobs(jobId: string): Array<[startTime: Date, jobFn: () => Promise<void>]> {
    return jobScheduler.scheduleJob.mock.calls
      .filter(c => c[0] === jobId)
      .map(([, startTime, , jobFn]) => [startTime, jobFn])
  }

  function lastScheduled(jobId: string): [startTime: Date, jobFn: () => Promise<void>] {
    const jobs = scheduledJobs(jobId)
    expect(jobs.length).toBeGreaterThan(0)
    return jobs.at(-1)!
  }

  /**
   * Waits for the service created in `beforeEach` to finish its startup sync, then restores the
   * seasons (without offsets) and clears the mocks, so that a newly created service starts fresh.
   */
  async function settleAndReset() {
    await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
    mockDbState = Array.from(STARTING_SEASONS)
    jobScheduler.scheduleJob.mockClear()
    jobScheduler.unscheduleJob.mockClear()
    nydus.publish.mockClear()
    getRatingDifferencesFromReferenceMock.mockClear()
    setMatchmakingSeasonDivisionRatingOffsetsMock.mockClear()
  }

  beforeEach(() => {
    clock = new FakeClock()
    clock.setCurrentTime(Number(new Date('2022-05-13T16:18:00')))
    jobScheduler = { scheduleJob: vi.fn(), unscheduleJob: vi.fn() }
    nydus = { publish: vi.fn() }
    clientSocketsManager = new EventEmitter()

    mockDbState = Array.from(STARTING_SEASONS)
    getMatchmakingSeasonsMock.mockClear()
    getMatchmakingSeasonsMock.mockImplementation(() => Promise.resolve(Array.from(mockDbState)))

    getRatingDifferencesFromReferenceMock.mockReset()
    getRatingDifferencesFromReferenceMock.mockResolvedValue(
      new Map([[MatchmakingType.Match3v3Bgh, Array.from({ length: 30 }, () => 150)]]),
    )
    setMatchmakingSeasonDivisionRatingOffsetsMock.mockReset()
    setMatchmakingSeasonDivisionRatingOffsetsMock.mockImplementation((seasonId, offsets) => {
      const index = mockDbState.findIndex(s => s.id === seasonId)
      if (index === -1 || mockDbState[index].divisionRatingOffsets) {
        return Promise.resolve(false)
      }
      mockDbState[index] = { ...mockDbState[index], divisionRatingOffsets: offsets }
      return Promise.resolve(true)
    })

    addMatchmakingSeasonMock.mockClear()
    addMatchmakingSeasonMock.mockImplementation(season => {
      // This isn't totally correct but should work fine given what we actually want to test
      const nextId = (mockDbState[0].id ?? 0) + 1
      const createdSeason = { ...season, id: makeSeasonId(nextId) }
      mockDbState = [createdSeason, ...mockDbState].sort(
        (a, b) => Number(b.startDate) - Number(a.startDate),
      )
      return Promise.resolve(createdSeason)
    })

    deleteMatchmakingSeasonMock.mockClear()
    deleteMatchmakingSeasonMock.mockImplementation(id => {
      mockDbState = mockDbState.filter(s => s.id !== id)
      return Promise.resolve()
    })

    service = createService()
  })

  test('should retrieve all seasons', async () => {
    const seasons = await service.getAllSeasons()
    expect(seasons).toHaveLength(3)
    expect(seasons[0].id).toBe(3)
    expect(seasons[0].startDate).toEqual(new Date('2023-01-01'))
  })

  test('should retrieve the right season for a given date', async () => {
    let [season, seasonEnd] = await service.getSeasonForDate(new Date('2022-05-01T00:00:00'))
    expect(season.id).toBe(1)
    expect(seasonEnd).toEqual(new Date('2022-06-01'))
    ;[season, seasonEnd] = await service.getSeasonForDate(new Date('2022-06-02T00:00:00'))
    expect(season.id).toBe(2)
    expect(seasonEnd).toEqual(new Date('2023-01-01'))
  })

  test('should retrieve the right season for the current date', async () => {
    let season = await service.getCurrentSeason()
    expect(season.id).toBe(1)

    clock.setCurrentTime(Number(new Date('2022-06-02T00:00:00')))
    season = await service.getCurrentSeason()
    expect(season.id).toBe(2)

    clock.setCurrentTime(Number(new Date('2025-06-02T00:00:00')))
    season = await service.getCurrentSeason()
    expect(season.id).toBe(3)
  })

  test('should allow adding a new season', async () => {
    const createdSeason = await service.addSeason({
      startDate: new Date('2025-01-01'),
      name: 'New Season',
      resetMmr: true,
    })

    expect(createdSeason).toMatchInlineSnapshot(`
      {
        "id": 4,
        "name": "New Season",
        "resetMmr": true,
        "startDate": 2025-01-01T00:00:00.000Z,
      }
    `)

    const seasons = await service.getAllSeasons()
    expect(seasons).toHaveLength(4)
    expect(seasons[0]).toEqual(createdSeason)
  })

  test('should prevent adding seasons in the past', async () => {
    const result = service.addSeason({
      startDate: new Date('2014-01-01'),
      name: 'Past Season',
      resetMmr: true,
    })

    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: New seasons must start in the future]`,
    )
  })

  test('should allow deleting future seasons', async () => {
    const result = service.deleteSeason(makeSeasonId(2))
    await expect(result).resolves.toBeUndefined()

    const seasons = await service.getAllSeasons()
    expect(seasons).toHaveLength(2)
    expect(seasons[0].id).toBe(3)
    expect(seasons[1].id).toBe(1)
  })

  test('should error when deleting a non-existent season', async () => {
    const result = service.deleteSeason(makeSeasonId(4))
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: No matching season found]`,
    )
  })

  test('should error when deleting a past/current season', async () => {
    const result = service.deleteSeason(makeSeasonId(1))
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Error: Only future seasons can be deleted]`,
    )
  })

  describe('division rating offsets', () => {
    test("computes the current season's offsets on construction", async () => {
      await vi.waitFor(() =>
        expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenCalledTimes(1),
      )
      const [seasonId, referenceType, types, minGames] =
        getRatingDifferencesFromReferenceMock.mock.calls[0]
      expect(seasonId).toBe(1)
      expect(referenceType).toBe(MatchmakingType.Match2v2)
      expect(types).toContain(MatchmakingType.Match3v3Bgh)
      expect(types).not.toContain(MatchmakingType.Match2v2)
      expect(types).not.toContain(MatchmakingType.Match1v1)
      expect(minGames).toBe(20)

      expect(setMatchmakingSeasonDivisionRatingOffsetsMock.mock.calls[0][0]).toBe(1)
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock.mock.calls[0][1]).toMatchObject({
        [MatchmakingType.Match3v3Bgh]: 150,
        [MatchmakingType.Match2v2Bgh]: 0,
      })

      // The stored offsets are picked up rather than served from a stale cache
      const current = await service.getCurrentSeason()
      expect(current.divisionRatingOffsets?.[MatchmakingType.Match3v3Bgh]).toBe(150)
    })

    test('leaves stored offsets alone', async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenCalledTimes(1)

      createService()
      await vi.waitFor(() => expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(2))
      expect(getRatingDifferencesFromReferenceMock).toHaveBeenCalledTimes(1)
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenCalledTimes(1)
    })

    test("schedules the next season's offsets at its start, then the one after", async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
      const [jobId, startTime, runEvery, jobFn] = jobScheduler.scheduleJob.mock.calls[0]
      expect(startTime).toEqual(new Date('2022-06-01'))
      expect(runEvery).toBe(-1)

      clock.setCurrentTime(Number(new Date('2022-06-01')))
      await jobFn()
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenLastCalledWith(
        2,
        expect.anything(),
      )
      expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(2)
      expect(jobScheduler.scheduleJob.mock.calls[1][0]).toBe(jobId)
      expect(jobScheduler.scheduleJob.mock.calls[1][1]).toEqual(new Date('2023-01-01'))

      clock.setCurrentTime(Number(new Date('2023-01-01')))
      await jobScheduler.scheduleJob.mock.calls[1][3]()
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenLastCalledWith(
        3,
        expect.anything(),
      )
      expect(jobScheduler.unscheduleJob).toHaveBeenCalledWith(jobId)
    })

    test('reschedules when seasons are added or deleted', async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))

      await service.addSeason({
        startDate: new Date('2022-05-20'),
        name: 'Sooner Season',
        resetMmr: false,
      })
      expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(2)
      expect(jobScheduler.scheduleJob.mock.calls[1][1]).toEqual(new Date('2022-05-20'))

      await service.deleteSeason(makeSeasonId(4))
      expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(3)
      expect(jobScheduler.scheduleJob.mock.calls[2][1]).toEqual(new Date('2022-06-01'))
    })

    test('retries a failed startup computation with backoff, scheduling the next season', async () => {
      await settleAndReset()
      getRatingDifferencesFromReferenceMock.mockRejectedValue(new Error('db down'))
      createService()

      await vi.waitFor(() => expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1))
      expect(lastScheduled(OFFSETS_JOB_ID)[0]).toEqual(new Date('2022-06-01'))

      const delays: number[] = []
      for (let i = 0; i < 7; i++) {
        const [startTime, retry] = lastScheduled(RETRY_JOB_ID)
        delays.push(Number(startTime) - clock.now())
        clock.setCurrentTime(Number(startTime))
        await retry()
      }
      expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000])
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).not.toHaveBeenCalled()

      getRatingDifferencesFromReferenceMock.mockResolvedValue(new Map())
      await lastScheduled(RETRY_JOB_ID)[1]()
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenCalledTimes(1)
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock.mock.calls[0][0]).toBe(1)
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(8)
    })

    test('retries loading the seasons on startup, then computes and schedules', async () => {
      await settleAndReset()
      getMatchmakingSeasonsMock.mockRejectedValueOnce(new Error('db down'))
      createService()

      await vi.waitFor(() => expect(scheduledJobs(SYNC_RETRY_JOB_ID)).toHaveLength(1))
      expect(lastScheduled(SYNC_RETRY_JOB_ID)[0]).toEqual(new Date(clock.now() + 60_000))
      expect(scheduledJobs(OFFSETS_JOB_ID)).toHaveLength(0)

      await lastScheduled(SYNC_RETRY_JOB_ID)[1]()
      expect(lastScheduled(OFFSETS_JOB_ID)[0]).toEqual(new Date('2022-06-01'))
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenCalledWith(
        1,
        expect.anything(),
      )
    })

    test("retries a failed season-start computation, scheduling the next season's", async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
      getRatingDifferencesFromReferenceMock.mockRejectedValueOnce(new Error('db down'))

      clock.setCurrentTime(Number(new Date('2022-06-01')))
      await lastScheduled(OFFSETS_JOB_ID)[1]()
      expect(lastScheduled(OFFSETS_JOB_ID)[0]).toEqual(new Date('2023-01-01'))
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1)

      await lastScheduled(RETRY_JOB_ID)[1]()
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenLastCalledWith(
        2,
        expect.anything(),
      )
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1)
    })

    test('stops retrying once a later season has started', async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
      getRatingDifferencesFromReferenceMock.mockRejectedValueOnce(new Error('db down'))
      clock.setCurrentTime(Number(new Date('2022-06-01')))
      await lastScheduled(OFFSETS_JOB_ID)[1]()
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1)

      getRatingDifferencesFromReferenceMock.mockClear()
      clock.setCurrentTime(Number(new Date('2023-01-02')))
      await lastScheduled(RETRY_JOB_ID)[1]()
      expect(getRatingDifferencesFromReferenceMock).not.toHaveBeenCalled()
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1)
    })

    test('stops retrying once the season has offsets', async () => {
      await settleAndReset()
      getRatingDifferencesFromReferenceMock.mockRejectedValue(new Error('db down'))
      createService()
      await vi.waitFor(() => expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1))

      // Stored by another server process in the meantime
      mockDbState = mockDbState.map(s =>
        s.id === 1 ? { ...s, divisionRatingOffsets: { [MatchmakingType.Match3v3Bgh]: 0 } } : s,
      )
      getRatingDifferencesFromReferenceMock.mockClear()
      await lastScheduled(RETRY_JOB_ID)[1]()
      expect(getRatingDifferencesFromReferenceMock).not.toHaveBeenCalled()
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1)
    })

    test('stops retrying once the season no longer exists', async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
      getRatingDifferencesFromReferenceMock.mockRejectedValueOnce(new Error('db down'))
      clock.setCurrentTime(Number(new Date('2022-06-01')))
      await lastScheduled(OFFSETS_JOB_ID)[1]()
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1)

      mockDbState = mockDbState.filter(s => s.id !== 2)
      getRatingDifferencesFromReferenceMock.mockClear()
      await lastScheduled(RETRY_JOB_ID)[1]()
      expect(getRatingDifferencesFromReferenceMock).not.toHaveBeenCalled()
      expect(scheduledJobs(RETRY_JOB_ID)).toHaveLength(1)
    })
  })

  describe('season updates for clients', () => {
    test('publishes a season once its offsets are stored', async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
      const [path, event] = nydus.publish.mock.calls[0]
      expect(path).toBe(MATCHMAKING_SEASONS_PATH)
      expect(event).toMatchObject({
        type: 'seasonUpdate',
        season: {
          id: 1,
          startDate: Number(new Date('2012-01-01')),
          name: 'Beta Season',
          divisionRatingOffsets: { [MatchmakingType.Match3v3Bgh]: 150 },
        },
      })
    })

    test("doesn't publish when another process stored the offsets first", async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))

      setMatchmakingSeasonDivisionRatingOffsetsMock.mockResolvedValueOnce(false)
      clock.setCurrentTime(Number(new Date('2022-06-01')))
      await lastScheduled(OFFSETS_JOB_ID)[1]()
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenLastCalledWith(
        2,
        expect.anything(),
      )
      expect(nydus.publish).toHaveBeenCalledTimes(1)
    })

    test('subscribes every new client, sending the current season', async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))

      for (const clientType of ['web', 'electron']) {
        const subscribe = vi.fn()
        clientSocketsManager.emit('newClient', {
          clientType,
          subscribe,
        } as unknown as ClientSocketsGroup)

        expect(subscribe).toHaveBeenCalledTimes(1)
        const [path, getInitialData] = subscribe.mock.calls[0]
        expect(path).toBe(MATCHMAKING_SEASONS_PATH)
        await expect(getInitialData()).resolves.toMatchObject({
          type: 'seasonUpdate',
          season: { id: 1, divisionRatingOffsets: { [MatchmakingType.Match3v3Bgh]: 150 } },
        })
      }
    })

    test("sends nothing on subscribe if the seasons can't be loaded", async () => {
      await vi.waitFor(() => expect(nydus.publish).toHaveBeenCalledTimes(1))
      const subscribe = vi.fn()
      clientSocketsManager.emit('newClient', {
        clientType: 'web',
        subscribe,
      } as unknown as ClientSocketsGroup)

      // Storing the offsets cleared the cache, so this load goes to the DB
      getMatchmakingSeasonsMock.mockRejectedValueOnce(new Error('db down'))
      await expect(subscribe.mock.calls[0][1]()).resolves.toBeUndefined()
    })
  })
})
