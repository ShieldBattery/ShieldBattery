import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecord } from '../../../common/games/games'
import { MatchmakingType } from '../../../common/matchmaking'
import { NON_EXISTING_USER_ID } from '../../../common/replays'
import { asMockedFunction } from '../../../common/testing/mocks'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getGameRecord } from '../games/game-models'
import { getMapInfos, getReplayMapCandidates } from '../maps/map-models'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import { getMatchmakingRatingChangesForGame } from '../matchmaking/models'
import { canUserAccessReplay } from './replay-access'
import { getBestReplayForGame, hasReplayForGameWithHash } from './replay-models'
import { ReplaySessionSourceService } from './replay-session-source-service'
import { ReplaySessionSources } from './replay-session-sources'

vi.mock('../games/game-models', () => ({ getGameRecord: vi.fn() }))
vi.mock('../maps/map-models', () => ({ getMapInfos: vi.fn(), getReplayMapCandidates: vi.fn() }))
vi.mock('../matchmaking/models', () => ({ getMatchmakingRatingChangesForGame: vi.fn() }))
vi.mock('./replay-access', () => ({ canUserAccessReplay: vi.fn() }))
vi.mock('./replay-models', () => ({
  getBestReplayForGame: vi.fn(),
  hasReplayForGameWithHash: vi.fn(),
}))

const PLAYER_ID = makeSbUserId(1)
const OTHER_ID = makeSbUserId(2)
const GAME_ID = 'game-a'
const HASH = Buffer.alloc(32, 1)
const START_TIME = new Date('2026-10-01T12:00:00Z')
const game = {
  id: GAME_ID,
  startTime: START_TIME,
  config: {
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: { type: MatchmakingType.Match1v1 },
    gameType: GameType.Melee,
    gameSubType: 0,
    teams: [
      [{ id: PLAYER_ID, race: 'p', isComputer: false }],
      [{ id: OTHER_ID, race: 'z', isComputer: false }],
    ],
  },
} as GameRecord
const slots = [
  { slotId: 0, name: 'Player at game time', race: 'p', team: 0, playerType: 'human' },
  { slotId: 1, name: 'Other', race: 'z', team: 1, playerType: 'human' },
].map(slot => ({ ...slot, isEmpty: false, isObserver: false }))
const sbData = {
  gameId: GAME_ID,
  userIds: [PLAYER_ID, OTHER_ID, ...Array(6).fill(NON_EXISTING_USER_ID)],
}

describe('ReplaySessionSources game metadata', () => {
  let service: ReplaySessionSources

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ReplaySessionSources(
      {} as ReplaySessionSourceService,
      {
        getSeasonForDate: vi.fn(async () => [
          { startDate: START_TIME, endDate: undefined },
          undefined,
        ]),
      } as unknown as MatchmakingSeasonsService,
    )
    asMockedFunction(getGameRecord).mockResolvedValue(game)
    asMockedFunction(getMapInfos).mockResolvedValue([])
    asMockedFunction(getReplayMapCandidates).mockResolvedValue([])
    asMockedFunction(canUserAccessReplay).mockReturnValue(true)
    asMockedFunction(getBestReplayForGame).mockResolvedValue({
      id: 'replay-a',
      hash: HASH,
      size: 100,
      header: { mapName: 'Bottleneck', gameType: 'melee', frames: 12000 },
      slots,
      sbData,
    } as any)
    asMockedFunction(getMatchmakingRatingChangesForGame).mockResolvedValue([
      {
        userId: PLAYER_ID,
        matchmakingType: MatchmakingType.Match1v1,
        rating: 1680,
        ratingChange: 40,
        points: 3000,
        pointsChange: 100,
        lifetimeGames: 10,
      } as any,
    ])
  })

  test('links verified replay slots and snapshots the pregame ranked standing', async () => {
    const result = await service.resolve({ kind: 'game', gameId: GAME_ID }, PLAYER_ID)

    expect(result.info.metadata.players[0]).toMatchObject({
      name: 'Player at game time',
      userId: PLAYER_ID,
      ranked: { matchmakingType: MatchmakingType.Match1v1, mmr: 1640 },
    })
    expect(result.info.metadata.players[0].ranked?.division).toBeDefined()
    expect(result.info.metadata.players[1]).toMatchObject({ userId: OTHER_ID })
    expect(result.info.metadata.players[1].ranked).toBeUndefined()
  })

  test('does not attribute a replay when its embedded game ID differs', async () => {
    asMockedFunction(getBestReplayForGame).mockResolvedValueOnce({
      id: 'replay-a',
      hash: HASH,
      size: 100,
      header: { mapName: 'Bottleneck', gameType: 'melee', frames: 12000 },
      slots,
      sbData: { ...sbData, gameId: 'another-game' },
    } as any)

    const result = await service.resolve({ kind: 'game', gameId: GAME_ID }, PLAYER_ID)

    expect(result.info.metadata.players[0]).toEqual({
      name: 'Player at game time',
      race: 'p',
      team: 0,
    })
    expect(getMatchmakingRatingChangesForGame).not.toHaveBeenCalled()
  })

  test('does not attribute a local replay unless its bytes match a stored game replay', async () => {
    const sourceService = {
      retainSourceForOwner: vi.fn(async () => ({
        id: 'source-a',
        hash: HASH,
        size: 100,
        header: { mapName: 'Bottleneck', gameType: 'melee', frames: 12000 },
        slots,
        sbData,
      })),
    }
    service = new ReplaySessionSources(
      sourceService as unknown as ReplaySessionSourceService,
      {
        getSeasonForDate: vi.fn(),
      } as unknown as MatchmakingSeasonsService,
    )
    asMockedFunction(hasReplayForGameWithHash).mockResolvedValue(false)

    const result = await service.resolve({ kind: 'upload', sourceId: 'source-a' }, PLAYER_ID)

    expect(result.info.metadata.players[0].userId).toBeUndefined()
    expect(result.info.metadata.players[0].ranked).toBeUndefined()
    expect(hasReplayForGameWithHash).toHaveBeenCalledWith(GAME_ID, HASH)
  })

  test('attributes a local replay whose bytes match a stored game replay', async () => {
    const sourceService = {
      retainSourceForOwner: vi.fn(async () => ({
        id: 'source-a',
        hash: HASH,
        size: 100,
        header: { mapName: 'Bottleneck', gameType: 'melee', frames: 12000 },
        slots,
        sbData,
      })),
    }
    service = new ReplaySessionSources(
      sourceService as unknown as ReplaySessionSourceService,
      {
        getSeasonForDate: vi.fn(async () => [
          { startDate: START_TIME, endDate: undefined },
          undefined,
        ]),
      } as unknown as MatchmakingSeasonsService,
    )
    asMockedFunction(hasReplayForGameWithHash).mockResolvedValue(true)

    const result = await service.resolve({ kind: 'upload', sourceId: 'source-a' }, PLAYER_ID)

    expect(result.info.metadata.players[0]).toMatchObject({
      userId: PLAYER_ID,
      ranked: { matchmakingType: MatchmakingType.Match1v1, mmr: 1640 },
    })
  })
})
