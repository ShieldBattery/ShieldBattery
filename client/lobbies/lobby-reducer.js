import { List, Record } from 'immutable'
import { nanoid } from 'nanoid'
import { Lobby, Team } from '../../common/lobbies/index'
import { Slot } from '../../common/lobbies/slot'
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

export class LobbyLoadingState extends Record({
  isCountingDown: false,
  countdownTimer: -1,
  isLoading: false,
}) {}

export class LobbyRecord extends Record({
  // TODO(tec27): This isn't totally correct as some parts of this are actually the JSON versions
  // (i.e. the map). This makes the normal Lobby functions usable on this though and dealing with
  // the types in Immutable is a real pain. We should clean this up when we move this off
  // Immutable though (and probably just move the Map data out of this struct generally).
  info: new Lobby(),
  loadingState: new LobbyLoadingState(),
  chat: List(),

  activated: false,
  hasUnread: false,
}) {
  get inLobby() {
    return !!(this.info && this.info.name)
  }
}

const infoReducer = keyedReducer(new Lobby(), {
  [LOBBY_INIT_DATA](state, action) {
    const { lobby } = action.payload
    const teams = lobby.teams.map(team => {
      const slots = team.slots.map(slot => new Slot(slot))
      const hiddenSlots = team.hiddenSlots.map(slot => new Slot(slot))
      return new Team({ ...team, slots: List(slots), hiddenSlots })
    })
    const lobbyInfo = new Lobby({
      ...lobby,
      teams: List(teams),
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
    return new Lobby()
  },

  [LOBBY_UPDATE_KICK_SELF](state, action) {
    return new Lobby()
  },

  [LOBBY_UPDATE_BAN_SELF](state, action) {
    return new Lobby()
  },

  [LOBBY_UPDATE_HOST_CHANGE](state, action) {
    return state.set('host', new Slot(action.payload))
  },

  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return new Lobby()
  },

  ['@network/connect'](state, action) {
    return new Lobby()
  },

  ['@maps/toggleFavorite'](state, action) {
    const { map } = action.meta

    if (state.map && state.map.id === map.id) {
      return state.setIn(['map', 'isFavorited'], !map.isFavorited)
    }

    return state
  },
})

const loadingReducer = keyedReducer(new LobbyLoadingState(), {
  [LOBBY_INIT_DATA](state, action) {
    return new LobbyLoadingState()
  },

  [LOBBY_UPDATE_LEAVE_SELF](state, action) {
    return new LobbyLoadingState()
  },

  [LOBBY_UPDATE_KICK_SELF](state, action) {
    return new LobbyLoadingState()
  },

  [LOBBY_UPDATE_BAN_SELF](state, action) {
    return new LobbyLoadingState()
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
    return state.set('isLoading', false).set('isCountingDown', false).set('countdownTimer', -1)
  },

  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return new LobbyLoadingState()
  },

  ['@network/connect'](state, action) {
    return new LobbyLoadingState()
  },
})

function prune(chatList) {
  return chatList.size > 200 ? chatList.shift() : chatList
}

const chatHandlers = {
  [LOBBY_UPDATE_CHAT_MESSAGE](lobbyInfo, lastLobbyInfo, state, action) {
    const newMessage = action.payload.message
    return state.push(
      new TextMessageRecord({
        id: nanoid(),
        time: newMessage.time,
        from: newMessage.from,
        text: newMessage.text,
      }),
    )
  },

  [LOBBY_UPDATE_SLOT_CREATE](lobbyInfo, lastLobbyInfo, state, action) {
    const { slot } = action.payload
    if (slot.type === 'human') {
      return state.push(
        new JoinLobbyMessageRecord({
          id: nanoid(),
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
        id: nanoid(),
        time: Date.now(),
        userId: player.userId,
      }),
    )
  },

  [LOBBY_UPDATE_KICK](lobbyInfo, lastLobbyInfo, state, action) {
    const { player } = action.payload
    return state.push(
      new KickLobbyPlayerMessageRecord({
        id: nanoid(),
        time: Date.now(),
        userId: player.userId,
      }),
    )
  },

  [LOBBY_UPDATE_BAN](lobbyInfo, lastLobbyInfo, state, action) {
    const { player } = action.payload
    return state.push(
      new BanLobbyPlayerMessageRecord({
        id: nanoid(),
        time: Date.now(),
        userId: player.userId,
      }),
    )
  },

  [LOBBY_INIT_DATA](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new SelfJoinLobbyMessageRecord({
        id: nanoid(),
        time: Date.now(),
        lobby: lobbyInfo.name,
        hostId: lobbyInfo.host.userId,
      }),
    )
  },

  [LOBBY_UPDATE_HOST_CHANGE](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new LobbyHostChangeMessageRecord({
        id: nanoid(),
        time: Date.now(),
        userId: lobbyInfo.host.userId,
      }),
    )
  },

  [LOBBY_UPDATE_COUNTDOWN_START](lobbyInfo, lastLobbyInfo, state, action, loadingState) {
    return state
      .push(
        new LobbyCountdownStartedMessageRecord({
          id: nanoid(),
          time: Date.now(),
        }),
      )
      .push(
        new LobbyCountdownTickMessageRecord({
          id: nanoid(),
          time: Date.now(),
          timeLeft: loadingState.countdownTimer,
        }),
      )
  },

  [LOBBY_UPDATE_COUNTDOWN_TICK](lobbyInfo, lastLobbyInfo, state, action, loadingState) {
    return state.push(
      new LobbyCountdownTickMessageRecord({
        id: nanoid(),
        time: Date.now(),
        timeLeft: loadingState.countdownTimer,
      }),
    )
  },

  [LOBBY_UPDATE_COUNTDOWN_CANCELED](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new LobbyCountdownCanceledMessageRecord({
        id: nanoid(),
        time: Date.now(),
      }),
    )
  },

  [LOBBY_UPDATE_LOADING_CANCELED](lobbyInfo, lastLobbyInfo, state, action) {
    return state.push(
      new LobbyLoadingCanceledMessageRecord({
        id: nanoid(),
        time: Date.now(),
        usersAtFault: action.payload.usersAtFault,
      }),
    )
  },
}

const EMPTY_CHAT = List()
function chatReducer(lobbyInfo, lastLobbyInfo, state, action, nextLoading) {
  if (!lobbyInfo.name) {
    return EMPTY_CHAT
  }
  return Object.hasOwn(chatHandlers, action.type)
    ? prune(chatHandlers[action.type](lobbyInfo, lastLobbyInfo, state, action, nextLoading))
    : state
}

export default function lobbyReducer(state = new LobbyRecord(), action) {
  const nextInfo = infoReducer(state.info, action)
  const nextLoading = loadingReducer(state.loadingState, action)
  const nextChat = chatReducer(nextInfo, state.info, state.chat, action, nextLoading)
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
    .set('loadingState', nextLoading)
    .set('chat', nextChat)
    .set('hasUnread', updated.hasUnread || (!updated.activated && nextChat !== state.chat))
}
