import { castDraft, Draft, Immutable } from 'immer'
import { nanoid } from 'nanoid'
import { GameType } from '../../common/games/game-type'
import { Lobby } from '../../common/lobbies'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { ReduxAction } from '../action-types'
import { CommonMessageType, SbMessage } from '../messaging/message-records'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import { LobbyMessageType } from './lobby-message-records'

export interface LobbyLoadingState {
  isCountingDown: boolean
  countdownTimer: number
  isLoading: boolean
}

const EMPTY_LOADING_STATE: LobbyLoadingState = Object.freeze({
  isCountingDown: false,
  countdownTimer: -1,
  isLoading: false,
})

const EMPTY_SLOT: Slot = Object.freeze({
  type: SlotType.Open,
  race: 'r',
  id: '',
  joinedAt: 0,
  hasForcedRace: false,
  playerId: 0,
  typeId: 0,
})

const EMPTY_LOBBY: Lobby = Object.freeze({
  id: '' as SbLobbyId,
  name: '',
  map: undefined,
  gameType: GameType.Melee,
  gameSubType: 0,
  teams: [],
  bench: [],
  host: EMPTY_SLOT,
  useLegacyLimits: false,
  visibility: 'listed',
  createdAt: 0,
})

export interface CurrentLobbyState {
  // TODO(tec27): `info` holds the server's JSON-serialized lobby directly, so e.g. `map` is a
  // `MapInfoJson` rather than a full `MapInfo`. We should probably move the map data out of this
  // struct generally.
  info: Lobby
  loadingState: LobbyLoadingState
  /** The lobby's chat log. */
  chat: SbMessage[]
  activated: boolean
  hasUnread: boolean
}

const DEFAULT_STATE: CurrentLobbyState = {
  info: EMPTY_LOBBY,
  loadingState: EMPTY_LOADING_STATE,
  chat: [],
  activated: false,
  hasUnread: false,
}

/** Returns whether the client currently considers itself to be a member of a lobby. */
export function isInLobby(state: CurrentLobbyState): boolean {
  return !!(state.info && state.info.name)
}

type LobbyDraft = Draft<CurrentLobbyState>

const CHAT_MESSAGE_LIMIT = 200

/**
 * Appends message(s) to the lobby chat log, then drops the oldest entry if it grew past the cap.
 * At most one entry is trimmed per call, even when the call pushes more than one message, so a
 * multi-message push can leave the log slightly over the cap until the next push.
 *
 * This is the only place that appends to the chat log, so it also owns unread tracking: a push
 * while the view isn't activated marks the log unread.
 */
function pushChat(draft: LobbyDraft, ...messages: SbMessage[]): void {
  draft.chat.push(...castDraft(messages))
  if (draft.chat.length > CHAT_MESSAGE_LIMIT) {
    draft.chat.shift()
  }
  draft.hasUnread ||= !draft.activated
}

/**
 * Applies the bookkeeping that runs after every handler below: once the lobby is gone, the view
 * state gets reset, with a non-empty chat log getting cleared on the way out counting as unread
 * (so leaving a lobby with unseen messages still queues up `hasUnread` for the next time one's
 * joined). The empty-chat case assigns nothing, leaving the state referentially unchanged for
 * actions that arrive while out of a lobby.
 */
function finalizeLobbyUpdate(draft: LobbyDraft): void {
  if (!draft.info.name) {
    draft.activated = false
    draft.hasUnread = draft.chat.length > 0
    if (draft.chat.length) {
      draft.chat = []
    }
  }
}

/**
 * Keys are constrained to real action types (and the handler map below is declared with
 * `satisfies`, so excess-property checking applies): a typo'd key fails to compile instead of
 * producing a handler that silently never fires.
 */
type LobbyHandlerMap = {
  [A in ReduxAction['type']]?: (
    draft: LobbyDraft,
    action: Extract<ReduxAction, { type: A }>,
    originalState: Immutable<CurrentLobbyState>,
  ) => void
}

type AnyLobbyHandler = (draft: LobbyDraft, action: any, originalState: any) => void

/**
 * Wraps every handler in `handlers` so that `finalizeLobbyUpdate` runs after each one
 * automatically, instead of relying on every handler remembering to call it itself. Making the
 * bookkeeping structural this way means a future handler can't forget it -- forgetting it would
 * silently break the leave-clears-chat behavior.
 */
function withLobbyBookkeeping<T extends LobbyHandlerMap>(handlers: T): T {
  const wrapped: Record<string, AnyLobbyHandler> = {}
  for (const key of Object.keys(handlers)) {
    const handler = (handlers as Record<string, AnyLobbyHandler>)[key]
    wrapped[key] = (draft, action, originalState) => {
      handler(draft, action, originalState)
      finalizeLobbyUpdate(draft)
    }
  }
  return wrapped as T
}

const lobbyHandlers = {
  '@lobbies/init'(draft, action) {
    draft.info = castDraft(action.payload.lobby)
    draft.loadingState = EMPTY_LOADING_STATE
    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.SelfJoinLobby,
      time: Date.now(),
      lobby: draft.info.name,
      hostId: draft.info.host.userId!,
    })
  },

  '@lobbies/updateSlotCreate'(draft, action) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      return
    }

    const { teamIndex, slotIndex, slot } = action.payload
    draft.info.teams[teamIndex].slots[slotIndex] = slot

    if (slot.type === SlotType.Human) {
      pushChat(draft, {
        id: nanoid(),
        type: LobbyMessageType.JoinLobby,
        time: Date.now(),
        userId: slot.userId!,
      })
    }
  },

  '@lobbies/updateRaceChange'(draft, action) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      return
    }

    const { teamIndex, slotIndex, newRace } = action.payload
    draft.info.teams[teamIndex].slots[slotIndex].race = newRace
  },

  '@lobbies/updateSlotChange'(draft, action) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      return
    }

    const { teamIndex, slotIndex, player } = action.payload
    draft.info.teams[teamIndex].slots[slotIndex] = player
  },

  '@lobbies/updateSettingsChange'(draft, action) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      return
    }

    draft.info = castDraft(action.payload.lobby)
    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.LobbySettingsChange,
      time: Date.now(),
      changedSettings: action.payload.changedSettings,
    })
  },

  '@lobbies/updateBenchAdd'(draft, action) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      return
    }

    draft.info.bench.push(action.payload.user)
    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.LobbyBenchJoin,
      time: Date.now(),
      userId: action.payload.user.userId,
    })
  },

  '@lobbies/updateBenchRemove'(draft, action) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      return
    }

    const { userId, reason } = action.payload
    draft.info.bench = draft.info.bench.filter(benched => benched.userId !== userId)

    // A reason means they're out of the lobby, which nothing else reports for a bench member. An
    // absent one means they were seated, which the accompanying slot events already describe.
    if (reason === 'left') {
      pushChat(draft, { id: nanoid(), type: LobbyMessageType.LeaveLobby, time: Date.now(), userId })
    } else if (reason === 'kicked') {
      pushChat(draft, {
        id: nanoid(),
        type: LobbyMessageType.KickLobbyPlayer,
        time: Date.now(),
        userId,
      })
    } else if (reason === 'banned') {
      pushChat(draft, {
        id: nanoid(),
        type: LobbyMessageType.BanLobbyPlayer,
        time: Date.now(),
        userId,
      })
    }
  },

  '@lobbies/updateLeaveSelf'(draft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
  },

  '@lobbies/updateKickSelf'(draft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
  },

  '@lobbies/updateBanSelf'(draft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
  },

  '@lobbies/updateHostChange'(draft, action) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      return
    }

    draft.info.host = action.payload
    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.LobbyHostChange,
      time: Date.now(),
      userId: draft.info.host.userId!,
    })
  },

  '@lobbies/updateGameStarted'(draft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
  },

  '@network/connect'(draft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
  },

  '@lobbies/updateChatMessage'(draft, action) {
    if (!draft.info.name) {
      return
    }

    const { message } = action.payload
    pushChat(draft, {
      id: nanoid(),
      type: CommonMessageType.TextMessage,
      time: message.time,
      from: message.from,
      text: message.text,
    })
  },

  '@lobbies/updateLeave'(draft, action) {
    if (!draft.info.name) {
      return
    }

    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.LeaveLobby,
      time: Date.now(),
      userId: action.payload.player.userId!,
    })
  },

  '@lobbies/updateKick'(draft, action) {
    if (!draft.info.name) {
      return
    }

    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.KickLobbyPlayer,
      time: Date.now(),
      userId: action.payload.player.userId!,
    })
  },

  '@lobbies/updateBan'(draft, action) {
    if (!draft.info.name) {
      return
    }

    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.BanLobbyPlayer,
      time: Date.now(),
      userId: action.payload.player.userId!,
    })
  },

  '@lobbies/updateCountdownStart'(draft, action) {
    draft.loadingState.isCountingDown = true
    draft.loadingState.countdownTimer = action.payload

    if (!draft.info.name) {
      return
    }

    pushChat(
      draft,
      { id: nanoid(), type: LobbyMessageType.LobbyCountdownStarted, time: Date.now() },
      {
        id: nanoid(),
        type: LobbyMessageType.LobbyCountdownTick,
        time: Date.now(),
        timeLeft: draft.loadingState.countdownTimer,
      },
    )
  },

  '@lobbies/updateCountdownTick'(draft, action) {
    draft.loadingState.countdownTimer = action.payload

    if (!draft.info.name) {
      return
    }

    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.LobbyCountdownTick,
      time: Date.now(),
      timeLeft: draft.loadingState.countdownTimer,
    })
  },

  '@lobbies/updateCountdownCanceled'(draft) {
    draft.loadingState.isCountingDown = false
    draft.loadingState.countdownTimer = -1

    if (!draft.info.name) {
      return
    }

    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.LobbyCountdownCanceled,
      time: Date.now(),
    })
  },

  '@lobbies/updateLoadingStart'(draft) {
    draft.loadingState.isLoading = true
    draft.loadingState.isCountingDown = false
  },

  '@lobbies/updateLoadingCanceled'(draft, action) {
    draft.loadingState.isLoading = false
    draft.loadingState.isCountingDown = false
    draft.loadingState.countdownTimer = -1

    if (!draft.info.name) {
      return
    }

    pushChat(draft, {
      id: nanoid(),
      type: LobbyMessageType.LobbyLoadingCanceled,
      time: Date.now(),
      usersAtFault: action.payload.usersAtFault,
    })
  },

  '@lobbies/activate'(draft) {
    if (draft.info.name) {
      draft.hasUnread = false
      draft.activated = true
    }
  },

  '@lobbies/deactivate'(draft) {
    if (draft.info.name) {
      draft.activated = false
    }
  },
} satisfies LobbyHandlerMap

export default immerKeyedReducer(DEFAULT_STATE, withLobbyBookkeeping(lobbyHandlers))
