import {
  MATCHMAKING_UPDATE_MATCH_ACCEPTED,
  MATCHMAKING_UPDATE_MATCH_FOUND,
  MATCHMAKING_UPDATE_MATCH_READY,
} from '../actions'
import { dispatch } from '../dispatch-registry'
import { openDialog, closeDialog } from '../dialogs/dialog-action-creator'

const eventToAction = {
  matchFound: (name, event) => {
    dispatch(openDialog('acceptMatch'))

    return {
      type: MATCHMAKING_UPDATE_MATCH_FOUND,
      payload: event,
    }
  },

  accepted: (name, event) => {
    return {
      type: MATCHMAKING_UPDATE_MATCH_ACCEPTED,
      payload: event,
    }
  },

  ready: (name, event) => {
    dispatch(closeDialog('acceptMatch'))

    // All players are ready; feel free to move to the loading screen and start the game
    return {
      type: MATCHMAKING_UPDATE_MATCH_READY,
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
