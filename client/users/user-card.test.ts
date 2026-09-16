import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { LadderPlayer, ladderPlayerToMatchmakingDivision } from '../../common/ladder/ladder'
import {
  getTotalBonusPoolForSeason,
  makeSeasonId,
  MatchmakingDivision,
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { RaceStats } from '../../common/races'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { UserProfileJson } from '../../common/users/user-network'
import { getRankLine } from './user-card'

// Answers with whatever default value the caller supplied (a second string argument, or a
// `defaultValue` field on the options object), interpolating any `{{placeholder}}` in it from the
// remaining option fields -- close enough to i18next's real behavior for the English strings this
// module renders.
const t = ((
  key: string,
  defaultValueOrOptions?: string | { defaultValue?: string; [option: string]: unknown },
  maybeOptions?: { [option: string]: unknown },
) => {
  const isDefaultValueString = typeof defaultValueOrOptions === 'string'
  const defaultValue = isDefaultValueString
    ? defaultValueOrOptions
    : (defaultValueOrOptions?.defaultValue ?? key)
  const options = isDefaultValueString ? maybeOptions : defaultValueOrOptions

  return Object.entries(options ?? {}).reduce(
    (result, [placeholder, value]) =>
      placeholder === 'defaultValue' || placeholder === 'defaultValue_one'
        ? result
        : result.replaceAll(`{{${placeholder}}}`, String(value)),
    defaultValue,
  )
}) as unknown as TFunction

const MOCK_USER_ID = makeSbUserId(1)

const MOCK_SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  name: 'Beta Season 3',
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
  points: number,
  wins: number,
  losses: number,
): LadderPlayer {
  return {
    ...NO_RACE_STATS,
    rank: 12,
    userId: MOCK_USER_ID,
    matchmakingType,
    seasonId: MOCK_SEASON.id,
    rating: 1750,
    points,
    bonusUsed: 0,
    lifetimeGames: wins + losses,
    wins,
    losses,
    lastPlayedDate: Date.now() - 1000 * 60 * 60 * 3,
  }
}

function makeProfile(ladder: Partial<Record<MatchmakingType, LadderPlayer>>): UserProfileJson {
  return {
    userId: MOCK_USER_ID,
    seasonId: MOCK_SEASON.id,
    ladder,
    userStats: { ...NO_RACE_STATS, userId: MOCK_USER_ID },
  }
}

describe('client/users/user-card getRankLine', () => {
  test('ranked, season loaded: names the most-played mode regardless of ladder key order', () => {
    // Match2v2 is listed first in the object but has fewer total games than Match1v1, which
    // should still be the one the line names.
    const ladder = {
      [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 18, 21),
      [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 74, 52),
    }
    const profile = makeProfile(ladder)
    const bonusPool = getTotalBonusPoolForSeason(new Date(), MOCK_SEASON)

    const result = getRankLine(profile, MOCK_SEASON, t)
    if (result.kind !== 'ranked') {
      throw new Error(`expected kind 'ranked', got '${result.kind}'`)
    }

    const expectedDivision = ladderPlayerToMatchmakingDivision(
      ladder[MatchmakingType.Match1v1],
      bonusPool,
    )
    const expectedDivisionLabel = matchmakingDivisionToLabel(expectedDivision, t)
    const expectedModeLabel = matchmakingTypeToLabel(MatchmakingType.Match1v1, t)
    const expectedPoints = Math.round(1840).toLocaleString()

    expect(result.badge).toBe(expectedDivision)
    expect(result.text).toBe(
      `${expectedDivisionLabel} · ${expectedModeLabel} · ${expectedPoints} pts`,
    )

    const expected2v2Division = ladderPlayerToMatchmakingDivision(
      ladder[MatchmakingType.Match2v2],
      bonusPool,
    )

    expect(result.modes).toEqual([
      {
        type: MatchmakingType.Match1v1,
        division: expectedDivision,
        points: 1840,
        wins: 74,
        losses: 52,
      },
      {
        type: MatchmakingType.Match2v2,
        division: expected2v2Division,
        points: 940,
        wins: 18,
        losses: 21,
      },
    ])
  })

  test('no ranked mode: unranked with the Unrated division badge', () => {
    const profile = makeProfile({})

    const result = getRankLine(profile, MOCK_SEASON, t)

    expect(result).toEqual({
      kind: 'unranked',
      badge: MatchmakingDivision.Unrated,
      text: 'Unranked',
    })
  })

  test('season not loaded: mode labels only, most-played first', () => {
    const ladder = {
      [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 18, 21),
      [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 74, 52),
    }
    const profile = makeProfile(ladder)

    const result = getRankLine(profile, undefined, t)

    const expectedText = `${matchmakingTypeToLabel(MatchmakingType.Match1v1, t)} · ${matchmakingTypeToLabel(MatchmakingType.Match2v2, t)}`

    expect(result).toEqual({
      kind: 'seasonUnknown',
      text: expectedText,
    })
  })
})
