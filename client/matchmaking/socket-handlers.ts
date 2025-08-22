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
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch, Dispatchable } from '../dispatch-registry'
import windowFocus from '../dom/window-focus'
import { lastGameAtom } from '../games/game-atoms'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { closeAcceptMatchDialog, getCurrentMapPool, openAcceptMatchDialog } from './action-creators'
import {
  addDraftChatMessage,
  completeDraft,
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
  matchLaunchingAtom,
} from './matchmaking-atoms'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in MatchmakingEvent['type']]: (
    matchmakingType: MatchmakingType,
    event: Extract<MatchmakingEvent, { type: E }>,
  ) => Dispatchable | undefined | void
}

const eventToAction: EventToActionMap = {
  matchFound: (matchmakingType, event) => {
    logger.debug(
      `Match found, showing accept dialog. ${event.acceptTimeLeftMillis}ms left, ` +
        `${event.acceptedPlayers} / ${event.numPlayers} accepted. ` +
        `Self accepted: ${event.hasAccepted}`,
    )
    ipcRenderer.send('userAttentionRequired')
    audioManager.playSound(AvailableSound.MatchFound)
    ipcRenderer.send('rallyPointRefreshPings')

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

    resetDraftState(jotaiStore)
    jotaiStore.set(draftStateAtom, event.draftState)

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
      matchmakingType: event.matchmakingType,
      race: event.race,
      startTime: window.performance.now(),
    })
  },

  requeue: (matchmakingType, event) => {
    logger.debug(`Re-entered matchmaking queue`)
    audioManager.playSound(AvailableSound.EnteredQueue)

    jotaiStore.set(foundMatchAtom, undefined)
  },

  matchReady: (matchmakingType, event) => (dispatch, getState) => {
    logger.debug(`Match is now ready, closing accept dialog`)
    dispatch(closeAcceptMatchDialog())
    resetDraftState(jotaiStore)

    jotaiStore.set(foundMatchAtom, undefined)
    jotaiStore.set(matchLaunchingAtom, true)
    dispatch(openDialog({ type: DialogType.LaunchingGame }))
  },

  cancelLoading: (matchmakingType, event) => (dispatch, getState) => {
    logger.debug(`Match loading canceled`)
    resetDraftState(jotaiStore)
    jotaiStore.set(matchLaunchingAtom, false)
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
    '/matchmakingPreferences/:userId/:matchmakingType',
    (route: RouteInfo, event: GetPreferencesResponse | Record<string, undefined>) => {
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
                replayPath: lastGame.replayPath,
                season: event.season,
              },
            }),
          )
        }
      })
    },
  )
}
