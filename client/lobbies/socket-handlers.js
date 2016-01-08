import {
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_JOIN,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_RACE_CHANGE,
} from '../actions'
import { dispatch } from '../dispatch-registry'

const eventToAction = {
  init: (name, event) => ({
    type: LOBBY_INIT_DATA,
    payload: event,
  }),

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
  })
}

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/lobbies/:lobby', (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.lobby, event)
    if (action) dispatch(action)
  })
}
