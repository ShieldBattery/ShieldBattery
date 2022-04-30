import { NydusClient, RouteHandler, RouteInfo } from 'nydus-client'
import { GameLaunchConfig, PlayerInfo } from '../../common/game-launch-config'
import { GameType } from '../../common/games/configuration'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  GetPreferencesResponse,
  MatchmakingEvent,
  MatchmakingStatusJson,
  MatchmakingType,
  MATCHMAKING_ACCEPT_MATCH_TIME_MS,
} from '../../common/matchmaking'
import { ACTIVE_GAME_LAUNCH } from '../actions'
import audioManager, { AudioManager, AvailableSound } from '../audio/audio-manager'
import { closeDialog, openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch, Dispatchable } from '../dispatch-registry'
import logger from '../logging/logger'
import { push, replace } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'
import { openSnackbar } from '../snackbars/action-creators'
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

interface CountdownState extends TimerState {
  sound: ReturnType<AudioManager['playFadeableSound']> | undefined
  atmosphere: ReturnType<AudioManager['playFadeableSound']> | undefined
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

const countdownState: CountdownState = {
  timer: undefined,
  sound: undefined,
  atmosphere: undefined,
}
function fadeAtmosphere(fast = true) {
  const { atmosphere } = countdownState
  if (atmosphere) {
    const timing = fast ? 1.5 : 3
    atmosphere.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + timing)
    atmosphere.source.stop(audioManager.currentTime + timing + 0.1)
    countdownState.atmosphere = undefined
  }
}
function clearCountdownTimer(leaveAtmosphere = false) {
  const { timer, sound, atmosphere } = countdownState
  if (timer) {
    clearInterval(timer)
    countdownState.timer = undefined
  }
  if (sound) {
    sound.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + 0.5)
    sound.source.stop(audioManager.currentTime + 0.6)
    countdownState.sound = undefined
  }
  if (!leaveAtmosphere && atmosphere) {
    fadeAtmosphere()
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
    push('/matchmaking/countdown')

    const {
      auth: { user },
    } = getState()

    const {
      hash,
      mapData: { format },
      mapUrl,
    } = event.chosenMap
    // Even though we're downloading the whole map pool as soon as the player enters the queue,
    // we're still leaving this as a check to make sure the map exists before starting a game.
    ipcRenderer.invoke('mapStoreDownloadMap', hash, format, mapUrl!)?.catch(err => {
      // TODO(tec27): Report this to the server so the loading is canceled immediately

      // This is already logged to our file by the map store, so we just log it to the console for
      // easy visibility during development
      console.error('Error downloading map: ' + err + '\n' + err.stack)
    })

    const totalPlayers = event.slots.length
    // TODO(tec27): If matchmaking bugs, this can result in floating point numbers (e.g. if
    // 3 players get queued into a 2v2), which breaks the game load. Ideally the server would send
    // the actual teams instead of just an array of players, and we'd use the first team's size to
    // pick the subtype. (Or the server could send the whole configuration directly)
    const teamSize = totalPlayers / 2
    const slots: PlayerInfo[] = event.slots.map((slot, i) => ({
      id: slot.id,
      name: slot.name,
      race: slot.race,
      playerId: slot.playerId,
      teamId: event.matchmakingType === MatchmakingType.Match1v1 || i < teamSize ? 0 : 1,
      type: slot.type,
      typeId: slot.typeId,
      userId: slot.userId,
    }))

    const config: GameLaunchConfig = {
      localUser: {
        id: user.id,
        name: user.name,
      },
      setup: {
        gameId: event.setup.gameId,
        name: 'Matchmaking game', // Does this even matter for anything?
        map: event.chosenMap,
        gameType:
          event.matchmakingType === MatchmakingType.Match1v1
            ? GameType.OneVsOne
            : GameType.TopVsBottom,
        gameSubType: event.matchmakingType === MatchmakingType.Match1v1 ? 0 : teamSize,
        slots,
        host: slots[0], // Arbitrarily set first player as host
        disableAllianceChanges: true,
        turnRate: event.setup.turnRate,
        userLatency: event.setup.userLatency,
        seed: event.setup.seed,
        resultCode: event.resultCode!,
        serverUrl: makeServerUrl(''),
      },
    }

    dispatch({
      type: ACTIVE_GAME_LAUNCH,
      payload: ipcRenderer.invoke('activeGameSetConfig', config),
    } as any)
  },

  setRoutes: (matchmakingType, event) => () => {
    const { routes, gameId } = event

    ipcRenderer.invoke('activeGameSetRoutes', gameId, routes)
  },

  // TODO(2Pac): Try to pull this out into a common place and reuse with lobbies
  startCountdown: (matchmakingType, event) => () => {
    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: '@matchmaking/countdownStarted',
      payload: tick,
    })

    countdownState.sound = audioManager.playFadeableSound(AvailableSound.Countdown)
    countdownState.atmosphere = audioManager.playFadeableSound(AvailableSound.Atmosphere)

    countdownState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: '@matchmaking/countdownTick',
        payload: tick,
      })
      if (!tick) {
        clearCountdownTimer(true /* leaveAtmosphere */)
      }
    }, 1000)
  },

  startWhenReady: (matchmakingType, event) => (dispatch, getState) => {
    const { gameId } = event

    const currentPath = location.pathname
    if (currentPath === '/matchmaking/countdown') {
      replace('/matchmaking/game-starting')
    }
    dispatch({ type: '@matchmaking/gameStarting' })

    ipcRenderer.invoke('activeGameStartWhenReady', gameId)
  },

  cancelLoading: (matchmakingType, event) => (dispatch, getState) => {
    clearCountdownTimer()

    const currentPath = location.pathname
    if (currentPath === '/matchmaking/countdown' || currentPath === '/matchmaking/game-starting') {
      replace('/')
    }
    dispatch({
      type: ACTIVE_GAME_LAUNCH,
      payload: ipcRenderer.invoke('activeGameSetConfig', {}),
    } as any)
    dispatch({ type: '@matchmaking/loadingCanceled' })
    dispatch(openSnackbar({ message: 'The game has failed to load.' }))
  },

  gameStarted: (matchmakingType, event) => (dispatch, getState) => {
    fadeAtmosphere(false /* fast */)

    const {
      matchmaking: { match },
    } = getState()

    if (!match) {
      logger.error('Received gameStarted event without a match')
      return
    }

    const currentPath = location.pathname
    if (currentPath === '/matchmaking/game-starting') {
      replace('/matchmaking/active-game')
    }
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
}
