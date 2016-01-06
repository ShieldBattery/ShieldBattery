import {
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_JOIN,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_RACE_CHANGE,
} from '../actions'
import { dispatch } from '../dispatch-registry'

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/lobbies/:lobby', (route, event) => {
    const action = eventToAction(route.params.lobby, event)
    if (action) dispatch(action)
  })
}

function eventToAction(lobbyName, event) {
  switch (event.type) {
    case 'init':
      return {
        type: LOBBY_INIT_DATA,
        payload: event,
      }
    case 'join':
      return {
        type: LOBBY_UPDATE_JOIN,
        payload: event.player,
      }
    case 'raceChange':
      return {
        type: LOBBY_UPDATE_RACE_CHANGE,
        payload: event,
      }
    case 'leave':
      return {
        type: LOBBY_UPDATE_LEAVE,
        payload: event.id,
      }
    case 'hostChange':
      return {
        type: LOBBY_UPDATE_HOST_CHANGE,
        payload: event.newId,
      }
    default:
      return null
  }
}
