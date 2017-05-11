import {
  MATCHMAKING_FIND,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
  MATCHMAKING_UPDATE_MATCH_ACCEPTED,
  MATCHMAKING_UPDATE_MATCH_FOUND,
  MATCHMAKING_UPDATE_MATCH_READY,
  MATCHMAKING_UPDATE_STATUS,
} from '../actions'
import { dispatch } from '../dispatch-registry'
import { openDialog, closeDialog } from '../dialogs/dialog-action-creator'
import { MATCHMAKING_ACCEPT_MATCH_TIME } from '../../app/common/constants'

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

const requeueState = {
  timer: null,
}
function clearRequeueTimer() {
  const { timer } = requeueState
  if (timer) {
    clearTimeout(timer)
    requeueState.timer = null
  }
}

const eventToAction = {
  matchFound: (name, event) => {
    clearRequeueTimer()
    clearAcceptMatchTimer()

    let tick = MATCHMAKING_ACCEPT_MATCH_TIME / 1000
    dispatch({
      type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
      payload: tick,
    })
    dispatch(openDialog('acceptMatch'))

    acceptMatchState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
        payload: tick,
      })
      if (tick <= 0) {
        clearAcceptMatchTimer()
      }
    }, 1000)

    return {
      type: MATCHMAKING_UPDATE_MATCH_FOUND,
      payload: event,
    }
  },

  playerAccepted: (name, event) => {
    return {
      type: MATCHMAKING_UPDATE_MATCH_ACCEPTED,
      payload: event,
    }
  },

  acceptTimeout: (name, event) => {
    return {
      type: MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED,
      payload: event,
    }
  },

  requeue: (name, event) => (dispatch, getState) => {
    clearRequeueTimer()
    clearAcceptMatchTimer()

    dispatch({
      type: MATCHMAKING_FIND,
    })
    requeueState.timer = setTimeout(() => {
      // TODO(tec27): we should allow people to close this dialog themselves, and if/when they do,
      // clear this timer
      dispatch(closeDialog())
    }, 5000)
  },

  matchReady: (name, event) => {
    dispatch(closeDialog())

    clearAcceptMatchTimer()
    // All players are ready; feel free to move to the loading screen and start the game
    return {
      type: MATCHMAKING_UPDATE_MATCH_READY,
      payload: event,
    }
  },

  status: (name, event) => ({
    type: MATCHMAKING_UPDATE_STATUS,
    payload: event,
  })
}

export default function registerModule({ siteSocket }) {
  const matchmakingHandler = (route, event) => {
    if (!eventToAction[event.type]) return

    const action = eventToAction[event.type](route.params.userName, event)
    if (action) dispatch(action)
  }
  siteSocket.registerRoute('/matchmaking/:userName', matchmakingHandler)
  siteSocket.registerRoute('/matchmaking/:userId/:clientId', matchmakingHandler)
}
