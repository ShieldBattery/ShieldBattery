import { NydusClient, RouteHandler, RouteInfo } from 'nydus-client'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { MatchmakingResultsEvent } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  GetPreferencesResponse,
  MATCHMAKING_ACCEPT_MATCH_TIME_MS,
  MatchmakingEvent,
  MatchmakingStatusJson,
  MatchmakingType,
} from '../../common/matchmaking'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { Dispatchable, dispatch } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { getCurrentMapPool } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

type EventToActionMap = {
  [E in MatchmakingEvent['type']]: (
    matchmakingType: MatchmakingType,
    event: Extract<MatchmakingEvent, { type: E }>,
  ) => Dispatchable
}

interface TimerState {
  timer: ReturnType<typeof setInterval> | undefined
}

const acceptMatchState: TimerState = {
  timer: undefined,
}

function clearAcceptMatchTimer() {
  const { timer } = acceptMatchState
  if (timer) {
    clearInterval(timer)
    acceptMatchState.timer = undefined
  }
}

const requeueState: TimerState = {
  timer: undefined,
}
function clearRequeueTimer() {
  const { timer } = requeueState
  if (timer) {
    clearTimeout(timer)
    requeueState.timer = undefined
  }
}

const eventToAction: EventToActionMap = {
  matchFound: (matchmakingType, event) => {
    ipcRenderer.send('userAttentionRequired')

    audioManager.playSound(AvailableSound.MatchFound)

    clearRequeueTimer()
    clearAcceptMatchTimer()
    ipcRenderer.send('rallyPointRefreshPings')

    let tick = MATCHMAKING_ACCEPT_MATCH_TIME_MS / 1000
    dispatch({
      type: '@matchmaking/acceptMatchTime',
      payload: tick,
    })
    dispatch(openDialog({ type: DialogType.AcceptMatch }))

    acceptMatchState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: '@matchmaking/acceptMatchTime',
        payload: tick,
      })
      if (tick <= 0) {
        clearAcceptMatchTimer()
      }
    }, 1000)

    return {
      type: '@matchmaking/matchFound',
      payload: event,
    }
  },

  playerAccepted: (matchmakingType, event) => {
    return {
      type: '@matchmaking/playerAccepted',
      payload: event,
    }
  },

  acceptTimeout: (matchmakingType, event) => {
    return {
      type: '@matchmaking/playerFailedToAccept',
      payload: event,
    }
  },

  startSearch: (matchmakingType, event) => {
    audioManager.playSound(AvailableSound.EnteredQueue)
    return {
      type: '@matchmaking/startSearch',
      payload: event,
    }
  },

  requeue: (matchmakingType, event) => (dispatch, getState) => {
    clearRequeueTimer()
    clearAcceptMatchTimer()

    audioManager.playSound(AvailableSound.EnteredQueue)
    dispatch({
      type: '@matchmaking/requeue',
      payload: {},
    })
    requeueState.timer = setTimeout(() => {
      // TODO(tec27): we should allow people to close this dialog themselves, and if/when they do,
      // clear this timer
      dispatch(closeDialog(DialogType.AcceptMatch))
    }, 5000)
  },

  matchReady: (matchmakingType, event) => (dispatch, getState) => {
    dispatch(closeDialog(DialogType.AcceptMatch))
    clearAcceptMatchTimer()

    // All players are ready; feel free to move to the loading screen and start the game
    dispatch({
      type: '@matchmaking/matchReady',
      payload: event,
    })
    dispatch(openDialog({ type: DialogType.LaunchingGame }))
  },

  setRoutes: (matchmakingType, event) => () => {
    const { routes, gameId } = event

    ipcRenderer.invoke('activeGameSetRoutes', gameId, routes)?.catch(swallowNonBuiltins)
  },

  cancelLoading: (matchmakingType, event) => (dispatch, getState) => {
    dispatch(closeDialog(DialogType.LaunchingGame))

    dispatch({
      type: '@active-game/launch',
      payload: ipcRenderer.invoke('activeGameSetConfig', {})!,
    })
    dispatch({ type: '@matchmaking/loadingCanceled' })
    externalShowSnackbar(
      i18n.t('matchmaking.match.gameFailedToLoad', 'The game has failed to load.'),
    )
  },

  gameStarted: (matchmakingType, event) => (dispatch, getState) => {
    const {
      matchmaking: { match },
    } = getState()

    if (!match) {
      logger.error('Received gameStarted event without a match')
      return
    }

    dispatch(closeDialog(DialogType.LaunchingGame))
    // TODO(tec27): This event is kind of absurd: we're pulling state out of the reducer to pass it
    // back to the reducer again? Should think more deeply about what we're trying to signal here
    dispatch({
      type: '@matchmaking/gameStarted',
      payload: {
        match,
      },
    })
  },

  queueStatus: (matchmakingType, event) => {
    return {
      type: '@matchmaking/queueStatus',
      payload: event,
    }
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
  siteSocket.registerRoute('/matchmaking/:userName', matchmakingHandler)
  siteSocket.registerRoute('/matchmaking/:userId/:clientId', matchmakingHandler)

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
        const { lastGame } = getState()

        if (event.game.id === lastGame.id) {
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
