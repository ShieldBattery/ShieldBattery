import activeGameManager from '../active-game/active-game-manager-instance'
import rallyPointManager from '../network/rally-point-manager-instance'
import mapStore from '../maps/map-store-instance'
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
}
function clearCountdownTimer() {
  const { timer } = countdownState
  if (timer) {
    clearInterval(timer)
    countdownState.timer = null
  }
}

const eventToAction = {
  matchFound: (name, event) => {
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
        name: event.matchInfo.type,
        map: event.chosenMap,
        gameType: 'oneVOne',
        slots: event.players,
        host: event.players[0], // Arbitrarily set first player as host
        seed: event.setup.seed,
      },
    }

    dispatch({ type: ACTIVE_GAME_LAUNCH, payload: activeGameManager.setGameConfig(config) })
  },

  setRoutes: (name, event) => dispatch => {
    const { routes, gameId } = event

    activeGameManager.setGameRoutes(gameId, routes)
  },

  startCountdown: (name, event) => (dispatch, getState) => {
    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: MATCHMAKING_UPDATE_COUNTDOWN_START,
      payload: tick,
    })
    dispatch(replace('/matchmaking/countdown'))

    countdownState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: MATCHMAKING_UPDATE_COUNTDOWN_TICK,
        payload: tick,
      })
      if (!tick) {
        clearCountdownTimer()
        dispatch({ type: MATCHMAKING_UPDATE_GAME_STARTING })
        dispatch(replace('/matchmaking/game-starting'))
      }
    }, 1000)
  },

  allowStart: (name, event) => {
    const { gameId } = event

    activeGameManager.allowStart(gameId)
  },

  cancelLoading: (name, event) => dispatch => {
    dispatch(closeDialog())
    clearAcceptMatchTimer()

    dispatch(replace('/'))
    dispatch({
      type: ACTIVE_GAME_LAUNCH,
      payload: activeGameManager.setGameConfig({}),
    })
    dispatch({ type: MATCHMAKING_UPDATE_LOADING_CANCELED })
    dispatch(openSnackbar({ message: 'The game has failed to load.' }))
  },

  gameStarted: (name, event) => {
    dispatch(replace('/matchmaking/active-game'))

    return {
      type: MATCHMAKING_UPDATE_GAME_STARTED,
    }
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
