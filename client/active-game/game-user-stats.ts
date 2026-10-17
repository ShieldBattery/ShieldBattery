import { TFunction } from 'i18next'
import { ReadonlyDeep } from 'type-fest'
import { GameUserStatsMode, GameUserStatsResult } from '../../common/ipc'
import {
  matchmakingDivisionToLabel,
  MatchmakingSeasonJson,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { raceCharToLabel } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserErrorCode, UserProfileJson } from '../../common/users/user-network'
import { ThunkAction } from '../dispatch-registry'
import { isFetchError } from '../network/fetch-errors'
import { findUserByName, viewUserProfile } from '../users/action-creators'
import { getMainRace, getRankedModes, RankedMode } from '../users/user-card'

/**
 * Builds the answer to a `/stats` command typed in game from the user's profile: their record and
 * main race, the mode they have their highest MMR in, and their standing in `currentType` (the mode
 * of the game being played, if it's a matchmaking game). Every label is localized for the game to
 * show as it is.
 */
export function toGameUserStats(
  name: string,
  profile: ReadonlyDeep<UserProfileJson>,
  season: ReadonlyDeep<MatchmakingSeasonJson> | undefined,
  currentType: MatchmakingType | undefined,
  t: TFunction,
): Extract<GameUserStatsResult, { kind: 'found' }> {
  const { pWins, tWins, zWins, rWins, pLosses, tLosses, zLosses, rLosses } = profile.userStats
  const race = getMainRace(profile.userStats)

  const modes = getRankedModes(profile, season).map(mode => ({
    mode,
    rating: profile.ladder[mode.type]!.rating,
  }))
  const best = modes.reduce<(typeof modes)[number] | undefined>(
    (best, entry) => (!best || entry.rating > best.rating ? entry : best),
    undefined,
  )
  const current = modes.find(({ mode }) => mode.type === currentType)

  const toStatsMode = (mode: RankedMode, rating: number): GameUserStatsMode => ({
    label: matchmakingTypeToLabel(mode.type, t),
    division:
      mode.division !== undefined
        ? matchmakingDivisionToLabel(mode.division, t)
        : t('users.card.divisionUnknown', 'Division unknown'),
    rating: Math.round(rating),
  })

  let currentMode: GameUserStatsMode | undefined
  if (current) {
    currentMode = toStatsMode(current.mode, current.rating)
  } else if (currentType !== undefined) {
    currentMode = { label: matchmakingTypeToLabel(currentType, t) }
  }

  return {
    kind: 'found',
    name,
    race: race ? raceCharToLabel(race, t) : undefined,
    wins: pWins + tWins + zWins + rWins,
    losses: pLosses + tLosses + zLosses + rLosses,
    bestMode: best ? toStatsMode(best.mode, best.rating) : undefined,
    currentMode,
  }
}

/**
 * Looks up the stats a `/stats` command typed in game asked for: those of the user named `name`,
 * or of the local user when no name was typed, including their standing in `currentType` (the
 * game's mode, if it's a matchmaking game). `onResult` is always called, with a failure result if
 * the user doesn't exist or their profile couldn't be loaded.
 */
export function lookUpGameUserStats(
  name: string | undefined,
  currentType: MatchmakingType | undefined,
  t: TFunction,
  onResult: (result: GameUserStatsResult) => void,
): ThunkAction {
  return (dispatch, getState) => {
    const loadProfile = (userId: SbUserId, userName: string) => {
      dispatch(
        viewUserProfile(userId, {
          onSuccess: () => {
            const state = getState()
            const profile = state.users.idToProfile.get(userId)
            if (!profile) {
              onResult({ kind: 'error', name: name ?? '' })
              return
            }
            const season = state.matchmakingSeasons.byId.get(profile.seasonId)
            onResult(toGameUserStats(userName, profile, season, currentType, t))
          },
          onError: () => onResult({ kind: 'error', name: name ?? '' }),
        }),
      )
    }

    if (name === undefined) {
      const self = getState().auth.self?.user
      if (self) {
        loadProfile(self.id, self.name)
      } else {
        onResult({ kind: 'error', name: '' })
      }
      return
    }

    dispatch(
      findUserByName(name, {
        onSuccess: user => loadProfile(user.id, user.name),
        onError: err =>
          onResult({
            kind: isFetchError(err) && err.code === UserErrorCode.NotFound ? 'notFound' : 'error',
            name,
          }),
      }),
    )
  }
}
