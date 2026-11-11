import { ReadonlyDeep } from 'type-fest'
import { GameUserStanding, GameUserStatsResult } from '../../common/ipc'
import { MatchmakingSeasonJson, MatchmakingType } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { UserErrorCode, UserProfileJson } from '../../common/users/user-network'
import { ThunkAction } from '../dispatch-registry'
import { isFetchError } from '../network/fetch-errors'
import { findUserByName, viewUserProfile } from '../users/action-creators'
import { getMainRace, getRankedModes, RankedMode } from '../users/user-card'

/**
 * Builds the stats the game shows for a user from their profile: their record and main race, the
 * mode they have their highest MMR in, and their standing in `currentType` (the mode of the game
 * being played, if it's a matchmaking game). The game labels everything itself, in its own
 * language, so nothing here is localized.
 */
export function toGameUserStats(
  name: string,
  profile: ReadonlyDeep<UserProfileJson>,
  season: ReadonlyDeep<MatchmakingSeasonJson> | undefined,
  currentType: MatchmakingType | undefined,
): Extract<GameUserStatsResult, { kind: 'found' }> {
  const { pWins, tWins, zWins, rWins, pLosses, tLosses, zLosses, rLosses } = profile.userStats

  const modes = getRankedModes(profile, season).map(mode => ({
    mode,
    rating: profile.ladder[mode.type]!.rating,
  }))
  const best = modes.reduce<(typeof modes)[number] | undefined>(
    (best, entry) => (!best || entry.rating > best.rating ? entry : best),
    undefined,
  )
  const current = modes.find(({ mode }) => mode.type === currentType)

  const toStanding = (mode: RankedMode, rating: number): GameUserStanding => ({
    matchmakingType: mode.type,
    division: mode.division,
    rating: Math.round(rating),
  })

  let currentStanding: GameUserStanding | undefined
  if (current) {
    currentStanding = toStanding(current.mode, current.rating)
  } else if (currentType !== undefined) {
    currentStanding = { matchmakingType: currentType }
  }

  return {
    kind: 'found',
    name,
    mainRace: getMainRace(profile.userStats),
    wins: pWins + tWins + zWins + rWins,
    losses: pLosses + tLosses + zLosses + rLosses,
    best: best ? toStanding(best.mode, best.rating) : undefined,
    current: currentStanding,
  }
}

/**
 * Looks up the stats the game asked for: those of the user named `name`, or of the local user when
 * no name was given, including their standing in `currentType` (the game's mode, if it's a
 * matchmaking game). `onResult` is always called, with a failure result if the user doesn't exist
 * or their profile couldn't be loaded.
 */
export function lookUpGameUserStats(
  name: string | undefined,
  currentType: MatchmakingType | undefined,
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
            onResult(toGameUserStats(userName, profile, season, currentType))
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
