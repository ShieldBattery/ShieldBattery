import cuid from 'cuid'
import { List, Record } from 'immutable'
import {
  LOBBY_ACTIVATE,
  LOBBY_DEACTIVATE,
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_BAN,
  LOBBY_UPDATE_BAN_SELF,
  LOBBY_UPDATE_CHAT_MESSAGE,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_KICK,
  LOBBY_UPDATE_KICK_SELF,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_LOADING_CANCELED,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_SLOT_CHANGE,
  LOBBY_UPDATE_SLOT_CREATE,
  LOBBY_UPDATE_SLOT_DELETED,
  NETWORK_SITE_CONNECTED,
} from '../actions'
import { TextMessageRecord } from '../messaging/message-records'
import { keyedReducer } from '../reducers/keyed-reducer'
import {
  BanLobbyPlayerMessageRecord,
  JoinLobbyMessageRecord,
  KickLobbyPlayerMessageRecord,
  LeaveLobbyMessageRecord,
  LobbyCountdownCanceledMessageRecord,
  LobbyCountdownStartedMessageRecord,
  LobbyCountdownTickMessageRecord,
  LobbyHostChangeMessageRecord,
  LobbyLoadingCanceledMessageRecord,
  SelfJoinLobbyMessageRecord,
} from './lobby-message-records'

export const Slot = new Record({
  type: null,
  name: null,
  race: null,
  id: null,
  joinedAt: null,
  controlledBy: null,
  teamId: null,
  hasForcedRace: false,
  playerId: null,
  typeId: 0,
  userId: null,
})
export const Team = new Record({
  name: null,
  teamId: null,
  isObserver: false,
  slots: new List(),
  originalSize: null,
  hiddenSlots: new List(),
})
export const LobbyInfo = new Record({
  name: null,
  map: null,
  gameType: null,
  gameSubType: null,
  teams: new List(),
  host: null,

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

const infoReducer = keyedReducer(undefined, {
  [LOBBY_INIT_DATA](state, action) {
    const { lobby } = action.payload
    const teams = lobby.teams.map(team => {
      const slots = team.slots.map(slot => new Slot(slot))
      const hiddenSlots = team.hiddenSlots.map(slot => new Slot(slot))
      return new Team({ ...team, slots: new List(slots), hiddenSlots })
    })
    const lobbyInfo = new LobbyInfo({
      ...lobby,
      teams: new List(teams),
      host: new Slot(lobby.host),
    })

    return lobbyInfo
  },

  [LOBBY_UPDATE_SLOT_CREATE](state, action) {
    const { teamIndex, slotIndex, slot } = action.payload
    return state.setIn(['teams', teamIndex, 'slots', slotIndex], new Slot(slot))
  },

  [LOBBY_UPDATE_SLOT_DELETED](state, action) {
    const { teamIndex, slotIndex } = action.payload
    return state.deleteIn(['teams', teamIndex, 'slots', slotIndex])
  },

  [LOBBY_UPDATE_RACE_CHANGE](state, action) {
    const { teamIndex, slotIndex, newRace } = action.payload
    return state.setIn(['teams', teamIndex, 'slots', slotIndex, 'race'], newRace)
  },

  [LOBBY_UPDATE_SLOT_CHANGE](state, action) {
    const { teamIndex, slotIndex, player } = action.payload
    return state.setIn(['teams', teamIndex, 'slots', slotIndex], new Slot(player))
  },

  [LOBBY_UPDATE_LEAVE_SELF](state, action) {
    return new LobbyInfo()
  },

  [LOBBY_UPDATE_KICK_SELF](state, action) {
    return new LobbyInfo()
  },

  [LOBBY_UPDATE_BAN_SELF](state, action) {
    return new LobbyInfo()
  },

  [LOBBY_UPDATE_HOST_CHANGE](state, action) {
    return state.set('host', new Slot(action.payload))
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
  },

  ['@maps/toggleFavorite'](state, action) {
    const { map } = action.meta

    if (state.map && state.map.id === map.id) {
      return state.setIn(['map', 'isFavorited'], !map.isFavorited)
    }

    return state
  },
})

function prune(chatList) {
  return chatList.size > 200 ? chatList.shift() : chatList
}

const chatHandlers = {
  [LOBBY_UPDATE_CHAT_MESSAGE](lobbyInfo, lastLobbyInfo, state, action) {
    const event = action.payload
    return state.push(
      new TextMessageRecord({
        id: cuid(),
        time: event.time,
        from: event.from,
        text: event.text,
        isHighlighted: event.isHighlighted,
      }),
    )
  },

  [LOBBY_UPDATE_SLOT_CREATE](lobbyInfo, lastLobbyInfo, state, action) {
    const { slot } = action.payload
    if (slot.type === 'human') {
      return state.push(
        new JoinLobbyMessageRecord({
          id: cuid(),
          time: Date.now(),
          userId: slot.userId,
        }),
      )
    }

    return state
  },

  [LOBBY_UPDATE_LEAVE](lobbyInfo, lastLobbyInfo, state, action) {
    const { player } = action.payload
    return state.push(
      new LeaveLobbyMessageRecord({
        id: cuid(),
        time: Date.now(),
        userId: player.userId,
      }),
    )
  },

  [LOBBY_UPDATE_KICK](lobbyInfo, lastLobbyInfo, state, action) {
    const { player } = action.payload
    return state.push(
      new KickLobbyPlayerMessageRecord({
        id: cuid(),
        time: Date.now(),
        userId: player.userId,
      }),
    )
  },

  [LOBBY_UPDATE_BAN](lobbyInfo, lastLobbyInfo, state, action) {
    const { player } = action.payload
    return state.push(
      new BanLobbyPlayerMessageRecord({
        id: cuid(),
        time: Date.now(),
        userId: player.userId,
      }),
    )
  },

  [LOBBY_INIT_DATA](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new SelfJoinLobbyMessageRecord({
        id: cuid(),
        time: Date.now(),
        lobby: lobbyInfo.name,
        hostId: lobbyInfo.host.userId,
      }),
    )
  },

  [LOBBY_UPDATE_HOST_CHANGE](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new LobbyHostChangeMessageRecord({
        id: cuid(),
        time: Date.now(),
        userId: lobbyInfo.host.userId,
      }),
    )
  },

  [LOBBY_UPDATE_COUNTDOWN_START](lobbyInfo, lastLobbyInfo, state, action) {
    return state
      .push(
        new LobbyCountdownStartedMessageRecord({
          id: cuid(),
          time: Date.now(),
        }),
      )
      .push(
        new LobbyCountdownTickMessageRecord({
          id: cuid(),
          time: Date.now(),
          timeLeft: lobbyInfo.countdownTimer,
        }),
      )
  },

  [LOBBY_UPDATE_COUNTDOWN_TICK](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new LobbyCountdownTickMessageRecord({
        id: cuid(),
        time: Date.now(),
        timeLeft: lobbyInfo.countdownTimer,
      }),
    )
  },

  [LOBBY_UPDATE_COUNTDOWN_CANCELED](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new LobbyCountdownCanceledMessageRecord({
        id: cuid(),
        time: Date.now(),
      }),
    )
  },

  [LOBBY_UPDATE_LOADING_CANCELED](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new LobbyLoadingCanceledMessageRecord({
        id: cuid(),
        time: Date.now(),
      }),
    )
  },
}

const EMPTY_CHAT = new List()
function chatReducer(lobbyInfo, lastLobbyInfo, state, action) {
  if (!lobbyInfo.name) {
    return EMPTY_CHAT
  }
  return chatHandlers.hasOwnProperty(action.type)
    ? prune(chatHandlers[action.type](lobbyInfo, lastLobbyInfo, state, action))
    : state
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
  return updated
    .set('info', nextInfo)
    .set('chat', nextChat)
    .set('hasUnread', updated.hasUnread || (!updated.activated && nextChat !== state.chat))
}
