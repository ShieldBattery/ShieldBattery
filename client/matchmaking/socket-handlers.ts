import { NydusClient, RouteHandler, RouteInfo } from 'nydus-client'
import { MatchmakingResultsEvent } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  GetPreferencesResponse,
  MatchmakingEvent,
  MatchmakingStatusJson,
  MatchmakingType,
} from '../../common/matchmaking'
import { audioManager, AvailableSound } from '../audio/audio-manager'
import { closeDialog, openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch, Dispatchable } from '../dispatch-registry'
import windowFocus from '../dom/window-focus'
import { lastGameAtom } from '../games/game-atoms'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { closeAcceptMatchDialog, getCurrentMapPool, openAcceptMatchDialog } from './action-creators'
import {
  addDraftChatMessage,
  completeDraft,
  draftMatchmakingTypeAtom,
  draftStateAtom,
  resetDraftState,
  updateCurrentPickerAtom,
  updateLockedPickAtom,
  updateProvisionalPickAtom,
} from './draft-atoms'
import {
  acceptedPlayersAtom,
  clearMatchmakingState,
  currentSearchInfoAtom,
  foundMatchAtom,
  launchingMatchmakingTypeAtom,
  matchLaunchingAtom,
} from './matchmaking-atoms'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in MatchmakingEvent['type']]: (
    matchmakingType: MatchmakingType,
    event: Extract<MatchmakingEvent, { type: E }>,
  ) => Dispatchable | undefined | void
}

/** Exported for tests; the socket routes are registered by the default export. */
export const eventToAction: EventToActionMap = {
  matchFound: (matchmakingType, event) => {
    logger.debug(
      `Match found, showing accept dialog. ${event.acceptTimeLeftMillis}ms left, ` +
        `${event.acceptedPlayers} / ${event.numPlayers} accepted. ` +
        `Self accepted: ${event.hasAccepted}`,
    )
    ipcRenderer.send('userAttentionRequired')
    audioManager.playSound(AvailableSound.MatchFound)

    jotaiStore.set(foundMatchAtom, {
      matchmakingType: event.matchmakingType,
      numPlayers: event.numPlayers,
      acceptStart:
        window.performance.now() - (event.acceptTimeTotalMillis - event.acceptTimeLeftMillis),
      acceptTimeTotalMillis: event.acceptTimeTotalMillis,

      acceptedPlayers: event.acceptedPlayers,
      hasAccepted: event.hasAccepted,
    })

    // We clear out this state so that we don't e.g. show the user a dialog about their previous
    // match that prevents them from accepting the new match.
    jotaiStore.set(lastGameAtom, undefined)

    dispatch(openAcceptMatchDialog())
  },

  draftStarted: (matchmakingType, event) => (dispatch, getState) => {
    logger.debug(`Draft started`)
    dispatch(closeAcceptMatchDialog())

    dispatch({
      type: '@maps/loadMapInfos',
      payload: [event.mapInfo],
    })

    // The accept phase is over once the draft begins, and `foundMatchAtom` describes only that
    // phase.
    jotaiStore.set(foundMatchAtom, undefined)

    resetDraftState(jotaiStore)
    jotaiStore.set(draftStateAtom, event.draftState)
    jotaiStore.set(draftMatchmakingTypeAtom, matchmakingType)

    ipcRenderer.send('userAttentionRequired')
  },

  draftPickStarted: (matchmakingType, event) => {
    jotaiStore.set(updateCurrentPickerAtom, {
      team: event.teamId,
      slot: event.index,
    })
  },

  draftProvisionalPick: (matchmakingType, event) => {
    jotaiStore.set(updateProvisionalPickAtom, {
      teamId: event.teamId,
      index: event.index,
      race: event.race,
    })
  },

  draftPickLocked: (matchmakingType, event) => {
    jotaiStore.set(updateLockedPickAtom, {
      teamId: event.teamId,
      index: event.index,
      race: event.race,
    })
  },

  draftCompleted: (matchmakingType, event) => {
    completeDraft(jotaiStore)
  },

  draftCancel: (matchmakingType, event) => {
    resetDraftState(jotaiStore)
  },

  draftChatMessage: (matchmakingType, event) => (dispatch, getState) => {
    const {
      auth,
      relationships: { blocks },
    } = getState()

    const isBlocked = blocks.has(event.message.from)
    if (!isBlocked) {
      ipcRenderer.send('chatNewMessage', {
        urgent: event.mentions.some(m => m.id === auth.self!.user.id),
      })
    }

    dispatch({
      type: '@messaging/loadMentions',
      payload: {
        mentions: event.mentions,
        channelMentions: event.channelMentions,
      },
    })

    addDraftChatMessage(jotaiStore, event.message)

    if (!isBlocked && !windowFocus.isFocused()) {
      audioManager.playSound(AvailableSound.MessageAlert)
    }
  },

  playerAccepted: (matchmakingType, event) => {
    logger.debug(`Player accepted, ${event.acceptedPlayers} players now ready`)
    jotaiStore.set(acceptedPlayersAtom, event.acceptedPlayers)
  },

  acceptTimeout: (matchmakingType, event) => dispatch => {
    logger.debug(`Timed out accepting match, showing failure dialog`)
    dispatch(closeAcceptMatchDialog())
    dispatch(openDialog({ type: DialogType.FailedToAcceptMatch }))
  },

  startSearch: (matchmakingType, event) => {
    logger.debug(`Matchmaking search started`)
    audioManager.playSound(AvailableSound.EnteredQueue)
    jotaiStore.set(currentSearchInfoAtom, {
      searchedTypes: new Map(event.searchedTypes.map(s => [s.matchmakingType, s.race])),
      startTime: window.performance.now(),
    })
  },

  requeue: (matchmakingType, event) => (_dispatch, getState) => {
    logger.debug(`Re-entered matchmaking queue`)
    audioManager.playSound(AvailableSound.EnteredQueue)

    // A requeue can follow any phase of a match falling apart. `foundMatchAtom` is only set during
    // the accept phase, so its presence here is what identifies a requeue caused by players failing
    // to ready up; a canceled draft or a failed load clears it before the requeue arrives and
    // carries its own messaging.
    const failedToAccept = !!jotaiStore.get(foundMatchAtom)
    jotaiStore.set(foundMatchAtom, undefined)

    // If the accept-match dialog was dismissed, it won't be around to show its own "returning to
    // queue" message, so show a snackbar with the same information instead.
    const dialogOpen = getState().dialog.history.some(d => d.type === DialogType.AcceptMatch)
    if (failedToAccept && !dialogOpen) {
      externalShowSnackbar(
        i18n.t(
          'matchmaking.acceptMatch.returningToQueue',
          "Some players didn't ready up in time or failed to load. Returning to the matchmaking " +
            'queue…',
        ),
        DURATION_LONG,
      )
    }
  },

  matchReady: (matchmakingType, event) => (dispatch, getState) => {
    logger.debug(`Match is now ready, closing accept dialog`)
    dispatch(closeAcceptMatchDialog())
    resetDraftState(jotaiStore)

    jotaiStore.set(foundMatchAtom, undefined)
    jotaiStore.set(matchLaunchingAtom, true)
    jotaiStore.set(launchingMatchmakingTypeAtom, matchmakingType)
    dispatch(openDialog({ type: DialogType.LaunchingGame }))
  },

  cancelLoading: (matchmakingType, event) => (dispatch, getState) => {
    logger.debug(`Match loading canceled`)
    resetDraftState(jotaiStore)
    jotaiStore.set(matchLaunchingAtom, false)
    jotaiStore.set(launchingMatchmakingTypeAtom, undefined)
    dispatch(closeDialog(DialogType.LaunchingGame))

    externalShowSnackbar(
      i18n.t('matchmaking.match.gameFailedToLoad', 'The game has failed to load.'),
    )
  },

  gameStarted: (matchmakingType, event) => (dispatch, getState) => {
    logger.debug(`Match started successfully`)
    clearMatchmakingState(jotaiStore)
    dispatch(closeDialog(DialogType.LaunchingGame))
    // TODO(tec27): Delete this event type after we get rid of active-game-reducer
    dispatch({
      type: '@matchmaking/gameStarted',
      payload: undefined,
    })
  },

  queueStatus: (matchmakingType, event) => {
    logger.debug(
      `Matchmaking queue status received: ${event.matchmaking ? JSON.stringify(event.matchmaking) : 'Not in queue'}`,
    )
    if (!event.matchmaking) {
      clearMatchmakingState(jotaiStore)
    }
    // NOTE(tec27): Any other state updates will be handled by `startSearch`
  },

  matchmakingServiceError: (matchmakingType, event) => dispatch => {
    logger.error('Matchmaking service error received — matchmaking was interrupted')
    clearMatchmakingState(jotaiStore)
    dispatch(
      openSimpleDialog(
        i18n.t('matchmaking.serviceError.dialogTitle', 'Matchmaking error'),
        i18n.t(
          'matchmaking.serviceError.removedFromQueue',
          'Matchmaking was interrupted due to a server error. Please re-queue to find a match.',
        ),
        true,
      ),
    )
  },
}

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  const matchmakingHandler: RouteHandler = (route: RouteInfo, event: MatchmakingEvent) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type]!(
      route.params.matchmakingType as MatchmakingType,
      event as any,
    )
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/matchmaking/:userId', matchmakingHandler)
  siteSocket.registerRoute('/matchmaking/:userId/:clientId', matchmakingHandler)

  // After a match has been found
  siteSocket.registerRoute('/matchmaking/matches/:matchId', matchmakingHandler)
  siteSocket.registerRoute('/matchmaking/matches/:matchId/teams/:teamId', matchmakingHandler)

  siteSocket.registerRoute(
    '/matchmakingStatus',
    (route: RouteInfo, event: MatchmakingStatusJson[]) => {
      dispatch({
        type: '@matchmaking/statusUpdate',
        payload: event,
      })
    },
  )

  siteSocket.registerRoute(
    '/matchmaking-preferences/:userId/:matchmakingType',
    (route: RouteInfo, event: GetPreferencesResponse) => {
      const type = route.params.matchmakingType as MatchmakingType

      dispatch((_, getState) => {
        const {
          mapPools: { byType },
        } = getState()

        if (!byType.has(type) || byType.get(type)!.id !== event.currentMapPoolId) {
          dispatch(getCurrentMapPool(type))
        }

        dispatch({
          type: '@matchmaking/initPreferences',
          payload: event,
          meta: { type },
        })
      })
    },
  )

  siteSocket.registerRoute(
    '/matchmaking-results/:userId',
    (_route: RouteInfo, event: MatchmakingResultsEvent) => {
      dispatch((dispatch, getState) => {
        const lastGame = jotaiStore.get(lastGameAtom)

        if (event.game.id === lastGame?.id) {
          dispatch(
            openDialog({
              type: DialogType.PostMatch,
              initData: {
                game: event.game,
                mmrChange: event.mmrChange,
                leagueChanges: event.leagueChanges,
                leagues: event.leagues,
                season: event.season,
              },
            }),
          )
        }
      })
    },
  )
}
