import {
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_JOIN,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_RACE_CHANGE,
} from '../actions'
import { dispatch } from '../dispatch-registry'

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
    const { auth, lobby } = getState()
    const user = auth.user.name
    const player = lobby.players.get(event.id).name
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
    const { bwPort: port } = getState().settings.local
    siteSocket.invoke('/lobbies/setNetworkInfo', { port })

    clearCountdownTimer()
    let tick = 5
    dispatch({
      type: LOBBY_UPDATE_COUNTDOWN_START,
      payload: tick,
    })

    // TODO(tec27): deal with cancellations

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
    const { lobby: { map, numSlots, players, hostId }, settings, auth: { user } } = getState()
    psiSocket.invoke('/site/setGameConfig', {
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
  },
}

export default function registerModule({ siteSocket, psiSocket }) {
  siteSocket.registerRoute('/lobbies/:lobby', (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.lobby, event, { siteSocket, psiSocket })
    if (action) dispatch(action)
  })
}
