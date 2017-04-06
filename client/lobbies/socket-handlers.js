import {
  ACTIVE_GAME_LAUNCH,
  LOBBIES_LIST_UPDATE,
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_BAN,
  LOBBY_UPDATE_BAN_SELF,
  LOBBY_UPDATE_CHAT_MESSAGE,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_KICK,
  LOBBY_UPDATE_KICK_SELF,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_LOADING_CANCELED,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_SLOT_CHANGE,
  LOBBY_UPDATE_SLOT_CREATE,
} from '../actions'
import {
  NEW_CHAT_MESSAGE,
} from '../../app/common/ipc-constants'

import { Slot } from './lobby-reducer'
import { dispatch } from '../dispatch-registry'
import rallyPointManager from '../network/rally-point-manager-instance'
import mapStore from '../maps/map-store-instance'
import activeGameManager from '../active-game/active-game-manager-instance'
import { getIngameLobbySlotsWithIndexes } from '../../app/common/lobbies'
import { openSnackbar } from '../snackbars/action-creators'

const ipcRenderer =
    process.webpackEnv.SB_ENV === 'electron' ? require('electron').ipcRenderer : null

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
    const { hash, format, mapUrl } = event.lobby.map
    mapStore.downloadMap(hash, format, mapUrl)
    rallyPointManager.refreshPings()

    return {
      type: LOBBY_INIT_DATA,
      payload: event,
    }
  },

  diff: (name, event) => dispatch => {
    for (const diffEvent of event.diffEvents) {
      const diffAction = eventToAction[diffEvent.type](name, diffEvent)
      if (diffAction) dispatch(diffAction)
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
    const { auth } = getState()

    const user = auth.user.name
    if (user === event.player.name) {
      // The leaver was me all along!!!
      clearCountdownTimer()
      dispatch({
        type: LOBBY_UPDATE_LEAVE_SELF,
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_LEAVE,
        payload: event,
      })
    }
  },

  kick: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.user.name
    if (user === event.player.name) {
      // We have been kicked from a lobby
      clearCountdownTimer()
      dispatch(openSnackbar({ message: 'You have been kicked from the lobby.' }))
      dispatch({
        type: LOBBY_UPDATE_KICK_SELF,
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_KICK,
        payload: event,
      })
    }
  },

  ban: (name, event) => (dispatch, getState) => {
    const { auth } = getState()

    const user = auth.user.name
    if (user === event.player.name) {
      // It was us who have been banned from a lobby (shame on us!)
      clearCountdownTimer()
      dispatch(openSnackbar({ message: 'You have been banned from the lobby.' }))
      dispatch({
        type: LOBBY_UPDATE_BAN_SELF,
      })
    } else {
      dispatch({
        type: LOBBY_UPDATE_BAN,
        payload: event,
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
      lobby,
      settings,
      auth: { user },
    } = getState()
    dispatch({ type: LOBBY_UPDATE_LOADING_START })
    // We tack on `teamId` to each slot here so we don't have to send two different things to game
    const slots = getIngameLobbySlotsWithIndexes(lobby.info).map(([teamIndex, , slot]) =>
        new Slot({ ...slot.toJS(), teamId: lobby.info.teams.get(teamIndex).teamId }))
    const { info: { name: lobbyName, map, gameType, gameSubType, host } } = lobby
    const config = {
      lobby: {
        name: lobbyName,
        map,
        gameType,
        gameSubType,
        slots,
        host,
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

  chat: (name, event) => {
    if (ipcRenderer) {
      // Notify the main process of the new message, so it can display an appropriate notification
      ipcRenderer.send(NEW_CHAT_MESSAGE, { user: event.from, message: event.text })
    }

    return {
      type: LOBBY_UPDATE_CHAT_MESSAGE,
      payload: event,
    }
  }
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
