import {
  ACTIVE_GAME_LAUNCH,
  LOBBIES_LIST_UPDATE,
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_CHAT_MESSAGE,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_LOADING_CANCELED,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_SLOT_CHANGE,
  LOBBY_UPDATE_SLOT_CREATE,
} from '../actions'
import { dispatch } from '../dispatch-registry'
import rallyPointManager from '../network/rally-point-manager-instance'
import mapStore from '../maps/map-store-instance'
import activeGameManager from '../active-game/active-game-manager-instance'
import { findSlotById } from '../../common/lobbies/lobby-slots'

let countdownTimer = null
function clearCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

const eventToAction = {
  init: (name, event) => {
    clearCountdownTimer()
    // TODO(tec27): handle errors on this?
    mapStore.downloadMap(event.lobby.map.hash, event.lobby.map.format)
    rallyPointManager.refreshPings()

    return {
      type: LOBBY_INIT_DATA,
      payload: event,
    }
  },

  slotCreate: (name, event) => ({
    type: LOBBY_UPDATE_SLOT_CREATE,
    payload: event,
  }),

  raceChange: (name, event) => ({
    type: LOBBY_UPDATE_RACE_CHANGE,
    payload: event,
  }),

  leave: (name, event) => (dispatch, getState) => {
    const { auth, lobby } = getState()

    const user = auth.user.name
    const [teamIndex, slotIndex, player] = findSlotById(lobby.info, event.id)
    if (user === player.name) {
      // The leaver was me all along!!!
      clearCountdownTimer()
      dispatch({
        type: LOBBY_UPDATE_LEAVE_SELF,
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_LEAVE,
        payload: {
          teamIndex,
          slotIndex,
          player,
        },
      })
    }
  },

  hostChange: (name, event) => ({
    type: LOBBY_UPDATE_HOST_CHANGE,
    payload: event.host,
  }),

  slotChange: (name, event) => ({
    type: LOBBY_UPDATE_SLOT_CHANGE,
    payload: event,
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

  setupGame: (name, event) => (dispatch, getState) => {
    clearCountdownTimer()
    const {
      lobby: {
        info: { name: lobbyName, map, gameType, gameSubType, numSlots, players, hostId },
      },
      settings,
      auth: { user },
    } = getState()
    dispatch({ type: LOBBY_UPDATE_LOADING_START })
    const config = {
      lobby: {
        name: lobbyName,
        map,
        gameType,
        gameSubType,
        numSlots,
        players,
        hostId,
      },
      settings,
      setup: event.setup,
      localUser: user,
    }

    dispatch({ type: ACTIVE_GAME_LAUNCH, payload: activeGameManager.setGameConfig(config) })
  },

  setRoutes: (name, event) => (dispatch, getState) => {
    const { routes } = event
    const { gameClient: { gameId } } = getState()
    activeGameManager.setGameRoutes(gameId, routes)
  },

  cancelLoading: (name, event) => dispatch => {
    dispatch({
      type: ACTIVE_GAME_LAUNCH,
      payload: activeGameManager.setGameConfig({})
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

export default function registerModule({ siteSocket }) {
  const lobbyHandler = (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.lobby, event, { siteSocket })
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
}
