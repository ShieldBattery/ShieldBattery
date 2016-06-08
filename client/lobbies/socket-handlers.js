import {
  LOBBIES_LIST_UPDATE,
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_CHAT_MESSAGE,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_JOIN,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_LOADING_CANCELED,
  LOBBY_UPDATE_RACE_CHANGE,
  PSI_GAME_LAUNCH,
  PSI_GAME_STATUS,
} from '../actions'
import { dispatch } from '../dispatch-registry'

let countdownTimer = null
function clearCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

let gameSetupPromise = null

const eventToAction = {
  init: (name, event, { psiSocket }) => {
    clearCountdownTimer()
    // TODO(tec27): handle errors on this?
    psiSocket.invoke('/site/activateMap', {
      hash: event.lobby.map.hash,
      format: event.lobby.map.format,
    })

    return {
      type: LOBBY_INIT_DATA,
      payload: event,
    }
  },

  join: (name, event) => ({
    type: LOBBY_UPDATE_JOIN,
    payload: event.player,
  }),

  raceChange: (name, event) => ({
    type: LOBBY_UPDATE_RACE_CHANGE,
    payload: event,
  }),

  leave: (name, event) => (dispatch, getState) => {
    const { auth, lobby: { info: lobbyInfo } } = getState()
    const user = auth.user.name
    const player = lobbyInfo.players.get(event.id).name
    if (user === player) {
      // The leaver was me all along!!!
      clearCountdownTimer()
      dispatch({
        type: LOBBY_UPDATE_LEAVE_SELF
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_LEAVE,
        payload: event.id,
      })
    }
  },

  hostChange: (name, event) => ({
    type: LOBBY_UPDATE_HOST_CHANGE,
    payload: event.newId,
  }),

  startCountdown: (name, event, { siteSocket }) => (dispatch, getState) => {
    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: LOBBY_UPDATE_COUNTDOWN_START,
      payload: tick,
    })

    countdownTimer = setInterval(() => {
      tick -= 1
      dispatch({
        type: LOBBY_UPDATE_COUNTDOWN_TICK,
        payload: tick
      })
      if (!tick) {
        clearCountdownTimer()
      }
    }, 1000)
  },

  cancelCountdown: (name, event) => {
    clearCountdownTimer()
    return {
      type: LOBBY_UPDATE_COUNTDOWN_CANCELED,
    }
  },

  setupGame: (name, event, { psiSocket }) => (dispatch, getState) => {
    clearCountdownTimer()
    const {
      lobby: {
        info: { map, numSlots, players, hostId },
      },
      settings,
      auth: { user },
    } = getState()
    dispatch({ type: LOBBY_UPDATE_LOADING_START })
    const promise = psiSocket.invoke('/site/setGameConfig', {
      lobby: {
        map,
        numSlots,
        players,
        hostId,
      },
      settings,
      setup: event.setup,
      localUser: user,
    })

    gameSetupPromise = promise

    dispatch({ type: PSI_GAME_LAUNCH, payload: promise })
  },

  setRoutes: (name, event, { psiSocket }) => async (dispatch, getState) => {
    if (!gameSetupPromise) return
    try {
      await gameSetupPromise
    } catch (err) {
      return
    }

    const { routes } = event
    const { gameClient: { gameId } } = getState()
    psiSocket.invoke('/site/setGameRoutes', {
      gameId,
      routes,
    })
  },

  cancelLoading: (name, event, { psiSocket }) => dispatch => {
    dispatch({
      type: PSI_GAME_LAUNCH,
      payload: psiSocket.invoke('/site/setGameConfig', null)
    })
    dispatch({ type: LOBBY_UPDATE_LOADING_CANCELED })
  },

  gameStarted: (name, event) => ({
    type: LOBBY_UPDATE_GAME_STARTED,
  }),

  chat: (name, event) => ({
    type: LOBBY_UPDATE_CHAT_MESSAGE,
    payload: event,
  })
}

export default function registerModule({ siteSocket, psiSocket }) {
  const lobbyHandler = (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.lobby, event, { siteSocket, psiSocket })
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/lobbies/:lobby', lobbyHandler)
  siteSocket.registerRoute('/lobbies/:lobby/:playerName', lobbyHandler)

  siteSocket.registerRoute('/lobbies', (route, event) => {
    const { action, payload } = event
    dispatch({
      type: LOBBIES_LIST_UPDATE,
      payload: {
        message: action,
        data: payload,
      }
    })
  })

  psiSocket.registerRoute('/game/status', (route, event) => {
    dispatch((dispatch, getState) => {
      const { gameClient } = getState()
      if (gameClient.gameId === event.id) {
        dispatch({ type: PSI_GAME_STATUS, payload: event })

        if (event.state === 'playing') {
          siteSocket.invoke('/lobbies/gameLoaded')
        } else if (event.state === 'error') {
          siteSocket.invoke('/lobbies/loadFailed')
        }
      }
    })
  })
}
