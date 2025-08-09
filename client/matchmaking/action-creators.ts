import { Immutable } from 'immer'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  defaultPreferences,
  DraftChatMessageRequest,
  DraftLockPickRequest,
  DraftProvisionalPickRequest,
  FindMatchRequest,
  GetMatchmakingBanStatusResponse,
  GetMatchmakingSeasonsResponse,
  GetPreferencesResponse,
  MatchmakingPreferences,
  MatchmakingServiceErrorCode,
  MatchmakingType,
  PartialMatchmakingPreferences,
} from '../../common/matchmaking'
import { GetMatchmakingMapPoolResponse } from '../../common/matchmaking/matchmaking-map-pools'
import { RaceChar } from '../../common/races'
import { apiUrl } from '../../common/urls'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { draftStateAtom, updateLockedPickAtom, updateProvisionalPickAtom } from './draft-atoms'
import { clearMatchmakingState, hasAcceptedAtom } from './matchmaking-atoms'

const ipcRenderer = new TypedIpcRenderer()

export function findMatch<M extends MatchmakingType>(
  {
    matchmakingType,
    preferences,
  }: {
    matchmakingType: M
    preferences:
      | Immutable<MatchmakingPreferences & { matchmakingType: M }>
      | Record<string, never>
      | undefined
  },
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    ipcRenderer.send('rallyPointRefreshPings')

    const {
      auth: { self },
      mapPools: { byType: mapPoolByType },
    } = getState()
    const selfId = self!.user.id

    const prefs =
      !!preferences && 'race' in preferences
        ? (preferences as Immutable<MatchmakingPreferences>)
        : defaultPreferences(
            matchmakingType,
            selfId,
            preferences?.mapPoolId ?? mapPoolByType.get(matchmakingType)?.id ?? 1,
          )

    const findPromise = Promise.resolve().then(async () => {
      const identifiers = (await ipcRenderer.invoke('securityGetClientIds')) ?? []

      const body: FindMatchRequest = {
        clientId,
        preferences: prefs as any,
        identifiers,
      }

      return fetchJson<void>(apiUrl`matchmaking/find`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    })

    findPromise.catch(err => {
      let message = i18n.t(
        'matchmaking.findMatch.errors.somethingWentWrong',
        'Something went wrong :(',
      )

      if (isFetchError(err) && err.code) {
        switch (err.code) {
          case MatchmakingServiceErrorCode.UserBanned:
            dispatch(openDialog({ type: DialogType.MatchmakingBanned }))
            return
          case MatchmakingServiceErrorCode.MatchmakingDisabled:
            message = i18n.t(
              'matchmaking.findMatch.errors.matchmakingDisabled',
              'Matchmaking is currently disabled',
            )
            break
          case MatchmakingServiceErrorCode.GameplayConflict:
            message = i18n.t(
              'matchmaking.findMatch.errors.alreadyInGame',
              'You are already in a game, searching for a match, or in a custom lobby',
            )
            break
          default:
            logger.error(
              `Unhandled error code while queueing for matchmaking as a solo player: ${err.code}`,
            )
            break
        }
      } else {
        logger.error(`Error while queuing for matchmaking as a solo player: ${err?.stack ?? err}`)
      }
      dispatch(
        openSimpleDialog(
          i18n.t('matchmaking.findMatch.errors.dialogTitle', 'Error searching for a match'),
          message,
          true,
        ),
      )
    })

    findPromise
      .then(() => {
        // Load the current map pool in the store so we can download all of the maps in it as soon
        // as the player queues.
        dispatch(getCurrentMapPool(matchmakingType))
      })
      .catch(swallowNonBuiltins)

    await findPromise
  })
}

export function cancelFindMatch(spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async () => {
    try {
      await fetchJson<void>(apiUrl`matchmaking/find`, { method: 'DELETE', signal: spec.signal })
    } catch (err) {
      logger.error(`Error while cancelling matchmaking: ${getErrorStack(err)}`)
      if (isFetchError(err) && err.code === MatchmakingServiceErrorCode.NotInQueue) {
        clearMatchmakingState(jotaiStore)
      }

      throw err
    }
  })
}

export function acceptMatch(spec: RequestHandlingSpec<void>): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`matchmaking/accept`, {
      method: 'POST',
      signal: spec.signal,
    })

    jotaiStore.set(hasAcceptedAtom, true)
  })
}

export function getCurrentMapPool(type: MatchmakingType): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@matchmaking/getCurrentMapPoolBegin',
      payload: { type },
    })

    const promise = fetchJson<GetMatchmakingMapPoolResponse>(
      apiUrl`matchmaking-map-pools/${type}/current`,
    )

    promise
      .then(body => {
        // As a slight optimization, we download the whole map pool as soon as we get it. This
        // shouldn't be a prohibitively expensive operation, since our map store checks if a map
        // already exists before attempting to download it.
        for (const map of body.mapInfos) {
          ipcRenderer
            .invoke('mapStoreDownloadMap', map.hash, map.mapData.format, map.mapUrl!)
            ?.catch(err => {
              // This is already logged to our file by the map store, so we just log it to the
              // console for easy visibility during development
              console.error('Error downloading map: ' + err.stack)
            })
        }
      })
      .catch(swallowNonBuiltins)

    dispatch({
      type: '@matchmaking/getCurrentMapPool',
      payload: promise,
      meta: { type },
    })
  }
}

export function updateMatchmakingPreferences<M extends MatchmakingType>(
  matchmakingType: M,
  prefs: Immutable<PartialMatchmakingPreferences & { matchmakingType: M }>,
): ThunkAction {
  return (dispatch, getState) => {
    const promise = fetchJson<GetPreferencesResponse>(
      apiUrl`matchmakingPreferences/${matchmakingType}`,
      {
        method: 'POST',
        body: JSON.stringify(prefs),
      },
    )

    dispatch({
      type: '@matchmaking/updatePreferences',
      payload: promise,
      meta: { type: matchmakingType },
    })

    promise
      .then(payload => {
        const {
          mapPools: { byType },
        } = getState()

        if (
          !byType.has(matchmakingType) ||
          byType.get(matchmakingType)!.id !== payload.currentMapPoolId
        ) {
          dispatch(getCurrentMapPool(matchmakingType))
        }
      })
      .catch(swallowNonBuiltins)
  }
}

export function getMatchmakingSeasons(
  spec: RequestHandlingSpec<GetMatchmakingSeasonsResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const result = await fetchJson<GetMatchmakingSeasonsResponse>(apiUrl`matchmaking/seasons`)

    dispatch({
      type: '@matchmaking/getMatchmakingSeasons',
      payload: result,
    })

    return result
  })
}

export function getMatchmakingBanStatus(
  spec: RequestHandlingSpec<GetMatchmakingBanStatusResponse>,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    return await fetchJson<GetMatchmakingBanStatusResponse>(apiUrl`matchmaking/ban-status`)
  })
}

export function changeDraftRace(
  { race }: { race: RaceChar },
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (_dispatch, getState) => {
    await fetchJson<void>(apiUrl`matchmaking/draft/provisional-pick`, {
      method: 'POST',
      body: encodeBodyAsParams<DraftProvisionalPickRequest>({
        race,
      }),
    })

    // The server should immediately send an update as well, but just so there is no delay (to
    // avoid weirdness with optimistic updates), we immediately set it here as well
    const draftState = jotaiStore.get(draftStateAtom)
    if (!draftState) {
      return
    }

    const { auth } = getState()

    const index = draftState.ownTeam.players.findIndex(p => p.userId === auth.self?.user.id)
    if (index !== -1) {
      jotaiStore.set(updateProvisionalPickAtom, {
        teamId: draftState.myTeamIndex,
        index,
        race,
      })
    }
  })
}

export function lockInDraftRace(
  { race }: { race: RaceChar },
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (_dispatch, getState) => {
    await fetchJson<void>(apiUrl`matchmaking/draft/lock-pick`, {
      method: 'POST',
      body: encodeBodyAsParams<DraftLockPickRequest>({
        race,
      }),
    })

    // The server should immediately send an update as well, but just so there is no delay (to
    // avoid weirdness with optimistic updates), we immediately set it here as well
    const draftState = jotaiStore.get(draftStateAtom)
    if (!draftState) {
      return
    }

    const { auth } = getState()

    const index = draftState.ownTeam.players.findIndex(p => p.userId === auth.self?.user.id)
    if (index !== -1) {
      jotaiStore.set(updateLockedPickAtom, {
        teamId: draftState.myTeamIndex,
        index,
        race,
      })
    }
  })
}

export function sendDraftChatMessage(
  { message }: { message: string },
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`matchmaking/draft/chat`, {
      method: 'POST',
      body: encodeBodyAsParams<DraftChatMessageRequest>({
        message,
      }),
    })
  })
}
