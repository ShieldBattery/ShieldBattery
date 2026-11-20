import { useEffect } from 'react'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { GameSource } from '../../common/games/configuration'
import { GameRecordJson } from '../../common/games/games'
import {
  getDivisionBeforeRatingChange,
  getDivisionContext,
  MatchmakingDivision,
  MatchmakingSeasonJson,
  PublicMatchmakingRatingChangeJson,
} from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppSelector } from '../redux-hooks'
import { findSeasonAt, loadMatchmakingSeasons } from './game-link-card'

/**
 * Returns the division each player of a ranked game was in going into it, placed with the bonus
 * pool of the season it was played in. Undefined when either the rating changes or the season are
 * missing.
 */
export function getDivisionsForGame(
  game: ReadonlyDeep<Pick<GameRecordJson, 'startTime'>>,
  mmrChanges: ReadonlyMap<SbUserId, PublicMatchmakingRatingChangeJson> | undefined,
  season: ReadonlyDeep<MatchmakingSeasonJson> | undefined,
): ReadonlyMap<SbUserId, MatchmakingDivision> | undefined {
  if (!mmrChanges || !season) {
    return undefined
  }
  const divisionContext = getDivisionContext(new Date(game.startTime), season)
  return new Map(
    Array.from(
      mmrChanges.values(),
      change => [change.userId, getDivisionBeforeRatingChange(change, divisionContext)] as const,
    ),
  )
}

/**
 * The division each player of a ranked game was in going into it, from the rating changes already
 * in the store (games lists carry them). Loads the matchmaking seasons when the game's season isn't
 * in the store yet. Undefined for custom games, and for ranked games whose rating changes or season
 * aren't available.
 */
export function useGameDivisions(
  game: ReadonlyDeep<GameRecordJson> | undefined,
): ReadonlyMap<SbUserId, MatchmakingDivision> | undefined {
  const isRanked = game?.config.gameSource === GameSource.Matchmaking
  const mmrChanges = useAppSelector(s =>
    game && isRanked ? s.games.mmrChangesById.get(game.id) : undefined,
  )
  const season = useAppSelector(s =>
    game && isRanked ? findSeasonAt(s.matchmakingSeasons.byId.values(), game.startTime) : undefined,
  )
  const needsSeasons = isRanked && mmrChanges !== undefined && season === undefined

  useEffect(() => {
    if (needsSeasons) {
      loadMatchmakingSeasons().catch(swallowNonBuiltins)
    }
  }, [needsSeasons])

  return game && isRanked ? getDivisionsForGame(game, mmrChanges, season) : undefined
}
