import {
  MATCHMAKING_FIND,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
  MATCHMAKING_UPDATE_MATCH_ACCEPTED,
  MATCHMAKING_UPDATE_MATCH_FOUND,
  MATCHMAKING_UPDATE_MATCH_READY,
} from '../actions'
import { dispatch } from '../dispatch-registry'
import { openDialog, closeDialog } from '../dialogs/dialog-action-creator'

const acceptMatchState = {
  timer: null,
}
function clearAcceptMatchTimer() {
  const { timer } = acceptMatchState
  if (timer) {
    clearInterval(timer)
    acceptMatchState.timer = null
  }
}

const eventToAction = {
  matchFound: (name, event) => {
    dispatch(openDialog('acceptMatch'))

    clearAcceptMatchTimer()
    let tick = 15
    dispatch({
      type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
      payload: tick,
    })

    acceptMatchState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
        payload: tick
      })
      if (!tick) {
        clearAcceptMatchTimer()
      }
    }, 1000)

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

  acceptFailed: (name, event) => (dispatch, getState) => {
    setTimeout(() => {
      const { matchmaking: { match: { type } }, matchmaking: { race } } = getState()
      dispatch(closeDialog())
      dispatch({
        type: MATCHMAKING_FIND,
        meta: {
          type,
          race,
        }
      })
    }, 5000)
  },

  ready: (name, event) => {
    dispatch(closeDialog())

    clearAcceptMatchTimer()
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
