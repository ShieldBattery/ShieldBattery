import { LOBBY_INIT_DATA, LOBBY_UPDATE_JOIN } from '../actions'
import { dispatch } from '../dispatch-registry'

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/lobbies/:lobby', (route, event) => {
    console.log('handler called')
    const action = eventToAction(route.params.lobby, event)
    console.log('action - ' + JSON.stringify(action))
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
    case 'join':
      console.log('event - ' + JSON.stringify(event))
      return {
        type: LOBBY_UPDATE_JOIN,
        payload: event.player,
      }
    default:
      return null
  }
}
