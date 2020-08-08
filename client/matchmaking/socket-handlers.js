import activeGameManager from '../active-game/active-game-manager-instance'
import rallyPointManager from '../network/rally-point-manager-instance'
import mapStore from '../maps/map-store-instance'
import audioManager, { SOUNDS } from '../audio/audio-manager-instance'
import {
  ACTIVE_GAME_LAUNCH,
  MATCHMAKING_FIND,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
  MATCHMAKING_UPDATE_GAME_STARTING,
  MATCHMAKING_UPDATE_GAME_STARTED,
  MATCHMAKING_UPDATE_LOADING_CANCELED,
  MATCHMAKING_UPDATE_MATCH_ACCEPTED,
  MATCHMAKING_UPDATE_COUNTDOWN_START,
  MATCHMAKING_UPDATE_COUNTDOWN_TICK,
  MATCHMAKING_UPDATE_MATCH_FOUND,
  MATCHMAKING_UPDATE_MATCH_READY,
  MATCHMAKING_UPDATE_STATUS,
} from '../actions'
import { dispatch } from '../dispatch-registry'
import { replace } from 'connected-react-router'
import { openDialog, closeDialog } from '../dialogs/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import { MATCHMAKING_ACCEPT_MATCH_TIME } from '../../common/constants'
import { USER_ATTENTION_REQUIRED } from '../../common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

const acceptMatchState = {
  timer: null,
}
function clearAcceptMatchTimer() {
  const { timer } = acceptMatchState
  if (timer) {
    clearInterval(timer)
    acceptMatchState.timer = null
  }
}

const requeueState = {
  timer: null,
}
function clearRequeueTimer() {
  const { timer } = requeueState
  if (timer) {
    clearTimeout(timer)
    requeueState.timer = null
  }
}

const countdownState = {
  timer: null,
  sound: null,
  atmosphere: null,
}
function fadeAtmosphere(fast = true) {
  const { atmosphere } = countdownState
  if (atmosphere) {
    const timing = fast ? 1.5 : 3
    atmosphere.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + timing)
    atmosphere.source.stop(audioManager.currentTime + timing + 0.1)
    countdownState.atmosphere = null
  }
}
function clearCountdownTimer(leaveAtmosphere = false) {
  const { timer, sound, atmosphere } = countdownState
  if (timer) {
    clearInterval(timer)
    countdownState.timer = null
  }
  if (sound) {
    sound.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + 0.5)
    sound.source.stop(audioManager.currentTime + 0.6)
    countdownState.sound = null
  }
  if (!leaveAtmosphere && atmosphere) {
    fadeAtmosphere()
  }
}

const eventToAction = {
  matchFound: (name, event) => {
    if (ipcRenderer) {
      ipcRenderer.send(USER_ATTENTION_REQUIRED)
    }

    clearRequeueTimer()
    clearAcceptMatchTimer()
    rallyPointManager.refreshPings()

    let tick = MATCHMAKING_ACCEPT_MATCH_TIME / 1000
    dispatch({
      type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
      payload: tick,
    })
    dispatch(openDialog('acceptMatch'))

    acceptMatchState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
        payload: tick,
      })
      if (tick <= 0) {
        clearAcceptMatchTimer()
      }
    }, 1000)

    return {
      type: MATCHMAKING_UPDATE_MATCH_FOUND,
      payload: event,
    }
  },

  playerAccepted: (name, event) => {
    return {
      type: MATCHMAKING_UPDATE_MATCH_ACCEPTED,
      payload: event,
    }
  },

  acceptTimeout: (name, event) => {
    return {
      type: MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED,
      payload: event,
    }
  },

  requeue: (name, event) => (dispatch, getState) => {
    clearRequeueTimer()
    clearAcceptMatchTimer()

    dispatch({
      type: MATCHMAKING_FIND,
    })
    requeueState.timer = setTimeout(() => {
      // TODO(tec27): we should allow people to close this dialog themselves, and if/when they do,
      // clear this timer
      dispatch(closeDialog())
    }, 5000)
  },

  matchReady: (name, event) => (dispatch, getState) => {
    dispatch(closeDialog())
    clearAcceptMatchTimer()

    // All players are ready; feel free to move to the loading screen and start the game
    dispatch({
      type: MATCHMAKING_UPDATE_MATCH_READY,
      payload: event,
    })
    dispatch(replace('/matchmaking/map-selection'))

    const {
      settings,
      auth: { user },
    } = getState()

    const {
      hash,
      mapData: { format },
      mapUrl,
    } = event.chosenMap
    // NOTE(2Pac): We can't download map any sooner since we don't know which map we'll play until
    // all players accept the game
    mapStore.downloadMap(hash, format, mapUrl)

    const config = {
      localUser: user,
      settings,
      setup: {
        gameId: event.setup.gameId,
        name: 'Matchmaking game', // Does this even matter for anything?
        map: event.chosenMap,
        gameType: 'oneVOne',
        slots: event.slots,
        host: event.slots[0], // Arbitrarily set first player as host
        seed: event.setup.seed,
      },
    }

    dispatch({ type: ACTIVE_GAME_LAUNCH, payload: activeGameManager.setGameConfig(config) })
  },

  setRoutes: (name, event) => dispatch => {
    const { routes, gameId } = event

    activeGameManager.setGameRoutes(gameId, routes)
  },

  // TODO(2Pac): Try to pull this out into a common place and reuse with lobbies
  startCountdown: (name, event) => (dispatch, getState) => {
    const {
      router: {
        location: { pathname: currentPath },
      },
    } = getState()

    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: MATCHMAKING_UPDATE_COUNTDOWN_START,
      payload: tick,
    })
    if (currentPath === '/matchmaking/map-selection') {
      dispatch(replace('/matchmaking/countdown'))
    }
    countdownState.sound = audioManager.playFadeableSound(SOUNDS.COUNTDOWN)
    countdownState.atmosphere = audioManager.playFadeableSound(SOUNDS.ATMOSPHERE)

    countdownState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: MATCHMAKING_UPDATE_COUNTDOWN_TICK,
        payload: tick,
      })
      if (!tick) {
        clearCountdownTimer(true /* leaveAtmosphere */)
      }
    }, 1000)
  },

  allowStart: (name, event) => (dispatch, getState) => {
    const { gameId } = event
    const {
      router: {
        location: { pathname: currentPath },
      },
    } = getState()

    if (currentPath === '/matchmaking/countdown') {
      dispatch(replace('/matchmaking/game-starting'))
    }
    dispatch({ type: MATCHMAKING_UPDATE_GAME_STARTING })

    activeGameManager.allowStart(gameId)
  },

  cancelLoading: (name, event) => (dispatch, getState) => {
    clearCountdownTimer()

    const {
      router: {
        location: { pathname: currentPath },
      },
    } = getState()

    if (
      currentPath === '/matchmaking/map-selection' ||
      currentPath === '/matchmaking/countdown' ||
      currentPath === '/matchmaking/game-starting'
    ) {
      dispatch(replace('/'))
    }
    dispatch({
      type: ACTIVE_GAME_LAUNCH,
      payload: activeGameManager.setGameConfig({}),
    })
    dispatch({ type: MATCHMAKING_UPDATE_LOADING_CANCELED })
    dispatch(openSnackbar({ message: 'The game has failed to load.' }))
  },

  gameStarted: (name, event) => (dispatch, getState) => {
    fadeAtmosphere(false /* fast */)

    const {
      matchmaking: { match },
      router: {
        location: { pathname: currentPath },
      },
    } = getState()

    if (currentPath === '/matchmaking/game-starting') {
      dispatch(replace('/matchmaking/active-game'))
    }
    dispatch({
      type: MATCHMAKING_UPDATE_GAME_STARTED,
      payload: {
        match,
      },
    })
  },

  status: (name, event) => ({
    type: MATCHMAKING_UPDATE_STATUS,
    payload: event,
  }),
}

export default function registerModule({ siteSocket }) {
  const matchmakingHandler = (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.userName, event)
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/matchmaking/:userName', matchmakingHandler)
  siteSocket.registerRoute('/matchmaking/:userId/:clientId', matchmakingHandler)
}
