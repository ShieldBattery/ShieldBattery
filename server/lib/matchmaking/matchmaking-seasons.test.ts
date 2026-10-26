import { beforeEach, describe, expect, Mock, test, vi } from 'vitest'
import { makeSeasonId, MatchmakingSeason, MatchmakingType } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { JobScheduler } from '../jobs/job-scheduler'
import { FakeClock } from '../time/testing/fake-clock'
import { MatchmakingSeasonsService } from './matchmaking-seasons'
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

  function createService() {
    return new MatchmakingSeasonsService(clock, jobScheduler as unknown as JobScheduler)
  }

  beforeEach(() => {
    clock = new FakeClock()
    clock.setCurrentTime(Number(new Date('2022-05-13T16:18:00')))
    jobScheduler = { scheduleJob: vi.fn(), unscheduleJob: vi.fn() }

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
      await vi.waitFor(() => expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(1))
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenCalledTimes(1)

      createService()
      await vi.waitFor(() => expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(2))
      expect(getRatingDifferencesFromReferenceMock).toHaveBeenCalledTimes(1)
      expect(setMatchmakingSeasonDivisionRatingOffsetsMock).toHaveBeenCalledTimes(1)
    })

    test("schedules the next season's offsets at its start, then the one after", async () => {
      await vi.waitFor(() => expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(1))
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
      await vi.waitFor(() => expect(jobScheduler.scheduleJob).toHaveBeenCalledTimes(1))

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
  })
})
