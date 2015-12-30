
import { LOBBY_INIT_DATA } from '../actions'
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
        payload: event.lobby,
      }
    default:
      return null
  }
}
