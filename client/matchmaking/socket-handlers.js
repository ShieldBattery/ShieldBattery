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
    dispatch(openDialog('acceptMatch'))

    clearRequeueTimer()
    clearAcceptMatchTimer()
    let tick = MATCHMAKING_ACCEPT_MATCH_TIME / 1000
    dispatch({
      type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
      payload: tick,
    })

    acceptMatchState.timer = setInterval(() => {
      tick -= 1
      dispatch({
        type: MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
        payload: tick,
      })
      if (!tick) {
        clearAcceptMatchTimer()
        dispatch({
          type: MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED,
        })
      }
    }, 1000)

    return {
      type: MATCHMAKING_UPDATE_MATCH_FOUND,
      payload: event,
    }
  },

  accept: (name, event) => {
    return {
      type: MATCHMAKING_UPDATE_MATCH_ACCEPTED,
      payload: event,
    }
  },

  requeue: (name, event) => (dispatch, getState) => {
    clearRequeueTimer()

    requeueState.timer = setTimeout(() => {
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
