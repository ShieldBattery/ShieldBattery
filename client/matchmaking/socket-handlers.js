import {
  MATCHMAKING_UPDATE_MATCH_FOUND,
} from '../actions'
import { dispatch } from '../dispatch-registry'
import { openDialog } from '../dialogs/dialog-action-creator'

const eventToAction = {
  matchFound: (name, event) => {
    dispatch(openDialog('acceptMatch'))

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
