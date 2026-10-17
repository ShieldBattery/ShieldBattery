import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  getTotalBonusPoolForSeason,
  makeSeasonId,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
} from '../../common/matchmaking'
import { RaceStats } from '../../common/races'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { UserProfileJson } from '../../common/users/user-network'
import { toGameUserStats } from './game-user-stats'

const t = ((key: string, options?: string | { defaultValue?: string }) =>
  typeof options === 'string' ? options : (options?.defaultValue ?? key)) as unknown as TFunction

const USER_ID = makeSbUserId(1)

const SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  name: 'Season 1',
  startDate: Date.now() - 1000 * 60 * 60 * 24 * 14,
  resetMmr: true,
}

const NO_RACE_STATS: RaceStats = {
  pWins: 0,
  pLosses: 0,
  tWins: 0,
  tLosses: 0,
  zWins: 0,
  zLosses: 0,
  rWins: 0,
  rLosses: 0,
  rPWins: 0,
  rPLosses: 0,
  rTWins: 0,
  rTLosses: 0,
  rZWins: 0,
  rZLosses: 0,
}

function makeLadderPlayer(
  matchmakingType: MatchmakingType,
  rating: number,
  lifetimeGames: number,
): LadderPlayer {
  return {
    ...NO_RACE_STATS,
    rank: 1,
    userId: USER_ID,
    matchmakingType,
    seasonId: SEASON.id,
    rating,
    points: 1200,
    bonusUsed: 0,
    lifetimeGames,
    wins: 10,
    losses: 5,
    lastPlayedDate: Date.now(),
  }
}

function makeProfile(
  ladder: Partial<Record<MatchmakingType, LadderPlayer>>,
  userStats: Partial<RaceStats>,
): UserProfileJson {
  return {
    userId: USER_ID,
    seasonId: SEASON.id,
    ladder,
    userStats: { ...NO_RACE_STATS, ...userStats, userId: USER_ID },
  }
}

function divisionLabel(player: LadderPlayer): string {
  const bonusPool = getTotalBonusPoolForSeason(new Date(), SEASON)
  return matchmakingDivisionToLabel(ladderPlayerToMatchmakingDivision(player, bonusPool), t)
}

describe('client/active-game/game-user-stats toGameUserStats', () => {
  const ladder = {
    // Played more, but rated lower than 2v2
    [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1640.4, 60),
    [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 1820.6, 20),
    // Rated highest, but too few games to count as rated
    [MatchmakingType.Match2v2Bgh]: makeLadderPlayer(
      MatchmakingType.Match2v2Bgh,
      2500,
      NUM_PLACEMENT_MATCHES - 1,
    ),
  }
  const profile = makeProfile(ladder, { pWins: 40, pLosses: 20, zWins: 5, zLosses: 5 })

  test('totals the record and picks the highest-rated mode as the best', () => {
    expect(toGameUserStats('tec27', profile, SEASON, undefined, t)).toEqual({
      kind: 'found',
      name: 'tec27',
      race: 'Protoss',
      wins: 45,
      losses: 25,
      bestMode: {
        label: '2v2',
        division: divisionLabel(ladder[MatchmakingType.Match2v2]),
        rating: 1821,
      },
      currentMode: undefined,
    })
  })

  test("includes the standing in the game's mode", () => {
    expect(
      toGameUserStats('tec27', profile, SEASON, MatchmakingType.Match1v1, t).currentMode,
    ).toEqual({
      label: '1v1',
      division: divisionLabel(ladder[MatchmakingType.Match1v1]),
      rating: 1640,
    })
  })

  test("a game's mode the user isn't rated in has no standing", () => {
    expect(
      toGameUserStats('tec27', profile, SEASON, MatchmakingType.Match2v2Bgh, t).currentMode,
    ).toEqual({ label: '2v2 BGH' })
  })

  test('a user rated in no mode has no best mode', () => {
    expect(toGameUserStats('newbie', makeProfile({}, {}), SEASON, undefined, t)).toEqual({
      kind: 'found',
      name: 'newbie',
      race: undefined,
      wins: 0,
      losses: 0,
      bestMode: undefined,
      currentMode: undefined,
    })
  })

  test('without a known season, divisions are labeled unknown', () => {
    expect(toGameUserStats('tec27', profile, undefined, undefined, t).bestMode).toEqual({
      label: '2v2',
      division: 'Division unknown',
      rating: 1821,
    })
  })
})
