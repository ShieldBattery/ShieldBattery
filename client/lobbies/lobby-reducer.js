import { Map, Record, List } from 'immutable'
import cuid from 'cuid'
import keyedReducer from '../reducers/keyed-reducer'
import { MapRecord } from './maps-reducer'
import {
  LOBBY_ACTIVATE,
  LOBBY_DEACTIVATE,
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_JOIN,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_CONTROLLER_CHANGE,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_LOADING_CANCELED,
  LOBBY_UPDATE_CHAT_MESSAGE,
  NETWORK_SITE_CONNECTED,
} from '../actions'

export const Player = new Record({
  name: null,
  id: null,
  race: 'r',
  isComputer: false,
  controlledBy: null,
  slot: -1
})
export const LobbyInfo = new Record({
  name: null,
  map: null,
  gameType: null,
  gameSubType: null,
  numSlots: 0,
  filledSlots: 0,
  players: new Map(),
  hostId: null,
  isCountingDown: false,
  countdownTimer: -1,
  isLoading: false,
})

const BaseLobbyRecord = new Record({
  info: new LobbyInfo(),
  chat: new List(),

  activated: false,
  hasUnread: false,
})
export class LobbyRecord extends BaseLobbyRecord {
  get inLobby() {
    return !!(this.info && this.info.name)
  }
}

const playersObjToMap = obj => {
  const records = Object.keys(obj).reduce((result, key) => {
    result[key] = new Player(obj[key])
    return result
  }, {})

  return new Map(records)
}

const infoReducer = keyedReducer(undefined, {
  [LOBBY_INIT_DATA](state, action) {
    const { lobby } = action.payload
    return new LobbyInfo({
      ...lobby,
      players: playersObjToMap(lobby.players),
      map: new MapRecord(lobby.map),
    })
  },

  [LOBBY_UPDATE_JOIN](state, action) {
    const player = new Player(action.payload)
    return (
      state.set('players', state.players.set(player.id, player))
        .set('filledSlots', state.filledSlots + (player.controlledBy ? 0 : 1))
    )
  },

  [LOBBY_UPDATE_RACE_CHANGE](state, action) {
    const { id, newRace } = action.payload
    return state.setIn(['players', id, 'race'], newRace)
  },

  [LOBBY_UPDATE_LEAVE](state, action) {
    return (
      state.deleteIn(['players', action.payload])
        .set('filledSlots', state.filledSlots -
            (state.players.get(action.payload).controlledBy ? 0 : 1))
    )
  },

  [LOBBY_UPDATE_LEAVE_SELF](state, action) {
    return new LobbyInfo()
  },

  [LOBBY_UPDATE_CONTROLLER_CHANGE](state, action) {
    const { id, newController } = action.payload
    return state.setIn(['players', id, 'controlledBy'], newController)
  },

  [LOBBY_UPDATE_HOST_CHANGE](state, action) {
    return state.set('hostId', action.payload)
  },

  [LOBBY_UPDATE_COUNTDOWN_START](state, action) {
    return state.set('isCountingDown', true).set('countdownTimer', action.payload)
  },

  [LOBBY_UPDATE_COUNTDOWN_TICK](state, action) {
    return state.set('countdownTimer', action.payload)
  },

  [LOBBY_UPDATE_COUNTDOWN_CANCELED](state, action) {
    return state.set('isCountingDown', false).set('countdownTimer', -1)
  },

  [LOBBY_UPDATE_LOADING_START](state, action) {
    return state.set('isLoading', true).set('isCountingDown', false)
  },

  [LOBBY_UPDATE_LOADING_CANCELED](state, action) {
    return state.set('isLoading', false)
  },

  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return new LobbyInfo()
  },

  [NETWORK_SITE_CONNECTED](state, action) {
    return new LobbyInfo()
  }
})

// id, type, and time need to be present for ALL message types
export const ChatMessage = Record({
  id: null,
  type: 'message',
  time: 0,
  from: null,
  text: null,
})
export const CountdownCanceledMessage = Record({
  id: null,
  type: 'countdownCanceled',
  time: 0,
})
export const CountdownStartedMessage = Record({
  id: null,
  type: 'countdownStarted',
  time: 0,
})
export const CountdownTickMessage = Record({
  id: null,
  type: 'countdownTick',
  time: 0,
  timeLeft: 0,
})
export const HostChangeMessage = Record({
  id: null,
  type: 'hostChange',
  time: 0,
  name: null,
})
export const JoinMessage = Record({
  id: null,
  type: 'join',
  time: 0,
  name: null,
})
export const LeaveMessage = Record({
  id: null,
  type: 'leave',
  time: 0,
  name: null,
})
export const LoadingCanceledMessage = Record({
  id: null,
  type: 'loadingCanceled',
  time: 0,
})
export const SelfJoinMessage = Record({
  id: null,
  type: 'selfJoin',
  time: 0,
  lobby: null,
  host: null,
})

function prune(chatList) {
  return chatList.size > 200 ? chatList.shift() : chatList
}

const chatHandlers = {
  [LOBBY_UPDATE_CHAT_MESSAGE](lobbyInfo, lastLobbyInfo, state, action) {
    const event = action.payload
    return state.push(new ChatMessage({
      id: cuid(),
      time: event.time,
      from: event.from,
      text: event.text,
    }))
  },

  [LOBBY_UPDATE_JOIN](lobbyInfo, lastLobbyInfo, state, action) {
    const player = action.payload
    if (!player.isComputer && !player.controlledBy) {
      return state.push(new JoinMessage({
        id: cuid(),
        time: Date.now(),
        name: player.name
      }))
    }

    return state
  },

  [LOBBY_UPDATE_LEAVE](lobbyInfo, lastLobbyInfo, state, action) {
    const player = lastLobbyInfo.players.get(action.payload)
    if (!player.isComputer && !player.controlledBy) {
      return state.push(new LeaveMessage({
        id: cuid(),
        time: Date.now(),
        name: player.name
      }))
    }

    return state
  },

  [LOBBY_INIT_DATA](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(new SelfJoinMessage({
      id: cuid(),
      time: Date.now(),
      lobby: lobbyInfo.name,
      host: lobbyInfo.players.get(lobbyInfo.hostId).name,
    }))
  },

  [LOBBY_UPDATE_HOST_CHANGE](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(new HostChangeMessage({
      id: cuid(),
      time: Date.now(),
      name: lobbyInfo.players.get(lobbyInfo.hostId).name,
    }))
  },

  [LOBBY_UPDATE_COUNTDOWN_START](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(new CountdownStartedMessage({
      id: cuid(),
      time: Date.now(),
    })).push(new CountdownTickMessage({
      id: cuid(),
      time: Date.now(),
      timeLeft: lobbyInfo.countdownTimer,
    }))
  },

  [LOBBY_UPDATE_COUNTDOWN_TICK](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(new CountdownTickMessage({
      id: cuid(),
      time: Date.now(),
      timeLeft: lobbyInfo.countdownTimer,
    }))
  },

  [LOBBY_UPDATE_COUNTDOWN_CANCELED](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(new CountdownCanceledMessage({
      id: cuid(),
      time: Date.now(),
    }))
  },

  [LOBBY_UPDATE_LOADING_CANCELED](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(new LoadingCanceledMessage({
      id: cuid(),
      time: Date.now(),
    }))
  },
}

const EMPTY_CHAT = new List()
function chatReducer(lobbyInfo, lastLobbyInfo, state, action) {
  if (!lobbyInfo.name) {
    return EMPTY_CHAT
  }
  return chatHandlers.hasOwnProperty(action.type) ?
      prune(chatHandlers[action.type](lobbyInfo, lastLobbyInfo, state, action)) :
      state
}

export default function lobbyReducer(state = new LobbyRecord(), action) {
  const nextInfo = infoReducer(state.info, action)
  const nextChat = chatReducer(nextInfo, state.info, state.chat, action)
  let updated = state
  if (!nextInfo.name) {
    updated = updated.set('hasUnread', false).set('activated', false)
  } else {
    if (action.type === LOBBY_ACTIVATE) {
      updated = updated.set('hasUnread', false).set('activated', true)
    } else if (action.type === LOBBY_DEACTIVATE) {
      updated = updated.set('activated', false)
    }
  }
  return (updated.set('info', nextInfo)
    .set('chat', nextChat)
    .set('hasUnread', updated.hasUnread || (!updated.activated && nextChat !== state.chat)))
}
