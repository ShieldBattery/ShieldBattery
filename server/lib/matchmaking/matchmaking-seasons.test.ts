import { makeSeasonId, MatchmakingSeason } from '../../../common/matchmaking'
import { asMockedFunction } from '../../../common/testing/mocks'
import { FakeClock } from '../time/testing/fake-clock'
import { MatchmakingSeasonsService } from './matchmaking-seasons'
import { addMatchmakingSeason, deleteMatchmakingSeason, getMatchmakingSeasons } from './models'

jest.mock('./models', () => ({
  getMatchmakingSeasons: jest.fn(),
  addMatchmakingSeason: jest.fn(),
  deleteMatchmakingSeason: jest.fn(),
}))

const getMatchmakingSeasonsMock = asMockedFunction(getMatchmakingSeasons)
const addMatchmakingSeasonMock = asMockedFunction(addMatchmakingSeason)
const deleteMatchmakingSeasonMock = asMockedFunction(deleteMatchmakingSeason)

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
  let service: MatchmakingSeasonsService

  beforeEach(() => {
    clock = new FakeClock()
    clock.setCurrentTime(Number(new Date('2022-05-13T16:18:00')))
    service = new MatchmakingSeasonsService(clock)

    let mockDbState = Array.from(STARTING_SEASONS)
    getMatchmakingSeasonsMock.mockClear()
    getMatchmakingSeasonsMock.mockImplementation(() => Promise.resolve(Array.from(mockDbState)))

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
  })

  test('should retrieve all seasons', async () => {
    const seasons = await service.getAllSeasons()
    expect(seasons).toHaveLength(3)
    expect(seasons[0].id).toBe(3)
    expect(seasons[0].startDate).toEqual(new Date('2023-01-01'))
  })

  test('should retrieve the right season for a given date', async () => {
    let season = await service.getSeasonForDate(new Date('2022-05-01T00:00:00'))
    expect(season.id).toBe(1)

    season = await service.getSeasonForDate(new Date('2022-06-02T00:00:00'))
    expect(season.id).toBe(2)
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
      `"New seasons must start in the future"`,
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
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(`"No matching season found"`)
  })

  test('should error when deleting a past/current season', async () => {
    const result = service.deleteSeason(makeSeasonId(1))
    await expect(result).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Only future seasons can be deleted"`,
    )
  })
})
