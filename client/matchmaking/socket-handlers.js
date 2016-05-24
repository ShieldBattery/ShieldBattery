import {
  MATCHMAKING_UPDATE_MATCH_FOUND,
} from '../actions'
import { dispatch } from '../dispatch-registry'
import { openSnackbar } from '../snackbars/action-creators'

const eventToAction = {
  matchFound: (name, event) => {
    dispatch(openSnackbar({
      message: 'Your opponent is: ' + event.opponent.name,
    }, 3000))

    return {
      type: MATCHMAKING_UPDATE_MATCH_FOUND,
      payload: event,
    }
  }
}

export default function registerModule({ siteSocket }) {
  siteSocket.registerRoute('/matchmaking/:userName', (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.userName, event)
    if (action) dispatch(action)
  })
}
