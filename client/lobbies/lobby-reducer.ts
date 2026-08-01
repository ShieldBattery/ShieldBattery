import { castDraft, Draft } from 'immer'
import { nanoid } from 'nanoid'
import { GameType } from '../../common/games/game-type'
import { Lobby } from '../../common/lobbies'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
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
} from '../actions'
import { CommonMessageType, SbMessage } from '../messaging/message-records'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
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
  host: EMPTY_SLOT,
  useLegacyLimits: false,
  visibility: 'listed',
})

export interface LobbyState {
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

const DEFAULT_STATE: LobbyState = {
  info: EMPTY_LOBBY,
  loadingState: EMPTY_LOADING_STATE,
  chat: [],
  activated: false,
  hasUnread: false,
}

/** Returns whether the client currently considers itself to be a member of a lobby. */
export function isInLobby(state: LobbyState): boolean {
  return !!(state.info && state.info.name)
}

/**
 * The mutable shape handlers below operate on. `info` is drafted through immer's `Draft<...>`
 * (`Lobby`/`Team`'s `teams`/`slots` fields are `readonly` and need unwrapping to be edited in
 * place); `chat` is left as its own already-mutable array type instead, rather than being drafted
 * as well -- its elements are Immutable.js message records, and immer's `Draft<T>` mapped type
 * would otherwise recurse into their generic, `this`-typed builder methods (`set`, `merge`, etc.)
 * for no benefit, since the records themselves are opaque leaf values immer never actually drafts
 * (their prototype isn't a plain object, so immer's own `isDraftable` check skips them at runtime).
 */
type LobbyDraft = Draft<Omit<LobbyState, 'chat'>> & Pick<LobbyState, 'chat'>

const CHAT_MESSAGE_LIMIT = 200

/**
 * Appends message(s) to the lobby chat log, then drops the oldest entry if it grew past the cap --
 * matching the previous Immutable.js-backed version's `List#shift`, at most one entry is trimmed
 * per call, even if the call pushes more than one message.
 */
function pushChat(draft: LobbyDraft, ...messages: SbMessage[]): void {
  draft.chat.push(...messages)
  if (draft.chat.length > CHAT_MESSAGE_LIMIT) {
    draft.chat.shift()
  }
}

/**
 * Applies the bookkeeping that runs after every handler below: if the lobby is gone, clears the
 * chat log along with `activated`/`hasUnread`; otherwise updates `hasUnread` from whether the chat
 * log just changed (`chatChanged`) and whether the view is currently activated. This mirrors the
 * interplay the previous Immutable.js-backed reducer had between these fields, including that
 * clearing a non-empty chat log on the way out of a lobby counts as a change in its own right (so
 * leaving a lobby with unread messages still queues up `hasUnread` for the next time one's joined).
 */
function finalizeLobbyUpdate(draft: LobbyDraft, chatChanged: boolean): void {
  if (!draft.info.name) {
    chatChanged = draft.chat.length > 0
    draft.chat = []
    draft.activated = false
    draft.hasUnread = false
  }
  draft.hasUnread = draft.hasUnread || (!draft.activated && chatChanged)
}

export default immerKeyedReducer(DEFAULT_STATE, {
  [LOBBY_INIT_DATA as any](draft: LobbyDraft, action: { payload: { lobby: Lobby } }) {
    draft.info = castDraft(action.payload.lobby)
    draft.loadingState = EMPTY_LOADING_STATE
    pushChat(
      draft,
      new SelfJoinLobbyMessageRecord({
        id: nanoid(),
        time: Date.now(),
        lobby: draft.info.name,
        hostId: draft.info.host.userId!,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_SLOT_CREATE as any](
    draft: LobbyDraft,
    action: { payload: { teamIndex: number; slotIndex: number; slot: Slot } },
  ) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      finalizeLobbyUpdate(draft, false)
      return
    }

    const { teamIndex, slotIndex, slot } = action.payload
    draft.info.teams[teamIndex].slots[slotIndex] = slot

    if (slot.type === SlotType.Human) {
      pushChat(
        draft,
        new JoinLobbyMessageRecord({ id: nanoid(), time: Date.now(), userId: slot.userId! }),
      )
      finalizeLobbyUpdate(draft, true)
    } else {
      finalizeLobbyUpdate(draft, false)
    }
  },

  [LOBBY_UPDATE_RACE_CHANGE as any](
    draft: LobbyDraft,
    action: { payload: { teamIndex: number; slotIndex: number; newRace: RaceChar } },
  ) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      finalizeLobbyUpdate(draft, false)
      return
    }

    const { teamIndex, slotIndex, newRace } = action.payload
    draft.info.teams[teamIndex].slots[slotIndex].race = newRace
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_UPDATE_SLOT_CHANGE as any](
    draft: LobbyDraft,
    action: { payload: { teamIndex: number; slotIndex: number; player: Slot } },
  ) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      finalizeLobbyUpdate(draft, false)
      return
    }

    const { teamIndex, slotIndex, player } = action.payload
    draft.info.teams[teamIndex].slots[slotIndex] = player
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_UPDATE_LEAVE_SELF as any](draft: LobbyDraft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_UPDATE_KICK_SELF as any](draft: LobbyDraft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_UPDATE_BAN_SELF as any](draft: LobbyDraft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_UPDATE_HOST_CHANGE as any](draft: LobbyDraft, action: { payload: Slot }) {
    if (!draft.info.name) {
      // Not in a lobby (e.g. this event trailed our own removal in a diff) - nothing to update
      finalizeLobbyUpdate(draft, false)
      return
    }

    draft.info.host = action.payload
    pushChat(
      draft,
      new LobbyHostChangeMessageRecord({
        id: nanoid(),
        time: Date.now(),
        userId: draft.info.host.userId!,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_GAME_STARTED as any](draft: LobbyDraft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
    finalizeLobbyUpdate(draft, false)
  },

  ['@network/connect' as any](draft: LobbyDraft) {
    draft.info = castDraft(EMPTY_LOBBY)
    draft.loadingState = EMPTY_LOADING_STATE
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_UPDATE_CHAT_MESSAGE as any](
    draft: LobbyDraft,
    action: { payload: { message: { time: number; from: SbUserId; text: string } } },
  ) {
    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
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
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_LEAVE as any](draft: LobbyDraft, action: { payload: { player: Slot } }) {
    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
      return
    }

    pushChat(
      draft,
      new LeaveLobbyMessageRecord({
        id: nanoid(),
        time: Date.now(),
        userId: action.payload.player.userId!,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_KICK as any](draft: LobbyDraft, action: { payload: { player: Slot } }) {
    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
      return
    }

    pushChat(
      draft,
      new KickLobbyPlayerMessageRecord({
        id: nanoid(),
        time: Date.now(),
        userId: action.payload.player.userId!,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_BAN as any](draft: LobbyDraft, action: { payload: { player: Slot } }) {
    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
      return
    }

    pushChat(
      draft,
      new BanLobbyPlayerMessageRecord({
        id: nanoid(),
        time: Date.now(),
        userId: action.payload.player.userId!,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_COUNTDOWN_START as any](draft: LobbyDraft, action: { payload: number }) {
    draft.loadingState.isCountingDown = true
    draft.loadingState.countdownTimer = action.payload

    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
      return
    }

    pushChat(
      draft,
      new LobbyCountdownStartedMessageRecord({ id: nanoid(), time: Date.now() }),
      new LobbyCountdownTickMessageRecord({
        id: nanoid(),
        time: Date.now(),
        timeLeft: draft.loadingState.countdownTimer,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_COUNTDOWN_TICK as any](draft: LobbyDraft, action: { payload: number }) {
    draft.loadingState.countdownTimer = action.payload

    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
      return
    }

    pushChat(
      draft,
      new LobbyCountdownTickMessageRecord({
        id: nanoid(),
        time: Date.now(),
        timeLeft: draft.loadingState.countdownTimer,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_COUNTDOWN_CANCELED as any](draft: LobbyDraft) {
    draft.loadingState.isCountingDown = false
    draft.loadingState.countdownTimer = -1

    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
      return
    }

    pushChat(draft, new LobbyCountdownCanceledMessageRecord({ id: nanoid(), time: Date.now() }))
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_UPDATE_LOADING_START as any](draft: LobbyDraft) {
    draft.loadingState.isLoading = true
    draft.loadingState.isCountingDown = false
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_UPDATE_LOADING_CANCELED as any](
    draft: LobbyDraft,
    action: { payload: { usersAtFault?: ReadonlyArray<SbUserId> } },
  ) {
    draft.loadingState.isLoading = false
    draft.loadingState.isCountingDown = false
    draft.loadingState.countdownTimer = -1

    if (!draft.info.name) {
      finalizeLobbyUpdate(draft, false)
      return
    }

    pushChat(
      draft,
      new LobbyLoadingCanceledMessageRecord({
        id: nanoid(),
        time: Date.now(),
        usersAtFault: action.payload.usersAtFault,
      }),
    )
    finalizeLobbyUpdate(draft, true)
  },

  [LOBBY_ACTIVATE as any](draft: LobbyDraft) {
    if (draft.info.name) {
      draft.hasUnread = false
      draft.activated = true
    }
    finalizeLobbyUpdate(draft, false)
  },

  [LOBBY_DEACTIVATE as any](draft: LobbyDraft) {
    if (draft.info.name) {
      draft.activated = false
    }
    finalizeLobbyUpdate(draft, false)
  },
})
