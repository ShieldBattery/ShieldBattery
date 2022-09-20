import cuid from 'cuid'
import { Immutable } from 'immer'
import { MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { SbMessage, TextMessageRecord } from '../messaging/message-records'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import {
  InviteToPartyMessageRecord,
  JoinPartyMessageRecord,
  KickFromPartyMessageRecord,
  LeavePartyMessageRecord,
  PartyLeaderChangeMessageRecord,
  PartyQueueCancelMessageRecord,
  PartyQueueReadyMessageRecord,
  PartyQueueStartMessageRecord,
  SelfJoinPartyMessageRecord,
} from './party-message-records'

// How many messages should be kept when a party is inactive
const INACTIVE_PARTY_MAX_HISTORY = 500

export interface PartyQueueState {
  id: string
  matchmakingType: MatchmakingType
  accepted: Map<SbUserId, RaceChar>
  unaccepted: Set<SbUserId>
}

export interface CurrentPartyState {
  id: string
  invites: SbUserId[]
  members: SbUserId[]
  leader: SbUserId

  messages: SbMessage[]
  hasUnread: boolean
  activated: boolean

  queueState?: PartyQueueState
}

export interface PartiesState {
  current?: CurrentPartyState
}

const DEFAULT_STATE: Immutable<PartiesState> = {
  current: undefined,
}

/** Adds a new message to the party chat, updating the unread state if needed. */
function addMessage(state: CurrentPartyState, message: SbMessage) {
  state.messages.push(message)
  state.hasUnread = state.hasUnread || !state.activated
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@parties/init'](state, action) {
    const {
      party: { id, invites, members, leader },
      time,
    } = action.payload

    state.current = {
      id,
      invites,
      members,
      leader,
      messages: [
        new SelfJoinPartyMessageRecord({
          id: cuid(),
          time,
          leaderId: leader,
        }),
      ],
      hasUnread: false,
      activated: false,
    }
  },

  ['@parties/updateInvite'](state, action) {
    const { partyId, invitedUser, time } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    const { current } = state

    if (!current.invites.includes(invitedUser)) {
      current.invites.push(invitedUser)
      addMessage(
        current,
        new InviteToPartyMessageRecord({
          id: cuid(),
          time,
          userId: invitedUser,
        }),
      )
    }
  },

  ['@parties/updateUninvite'](state, action) {
    const { partyId, target } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    const index = state.current.invites.findIndex(id => id === target)
    if (index !== -1) {
      state.current.invites.splice(index, 1)
    }
  },

  ['@parties/updateJoin'](state, action) {
    const { partyId, user, time } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    const { current } = state

    const index = current.invites.findIndex(id => id === user)
    if (index !== -1) {
      current.invites.splice(index, 1)
    }
    if (!current.members.includes(user)) {
      current.members.push(user)
      addMessage(
        current,
        new JoinPartyMessageRecord({
          id: cuid(),
          time,
          userId: user,
        }),
      )
    }
  },

  ['@parties/updateLeave'](state, action) {
    const { partyId, user, time } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    const index = state.current.members.findIndex(id => id === user)
    // This action can be dispatched *after* a player gets kicked as well, in which case there's no
    // need to do any cleanup, nor display a "leave" message.
    if (index !== -1) {
      state.current.members.splice(index, 1)
      addMessage(
        state.current,
        new LeavePartyMessageRecord({
          id: cuid(),
          time,
          userId: user,
        }),
      )
    }
  },

  ['@parties/updateLeaveSelf'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.current?.id) {
      return state
    }

    return DEFAULT_STATE
  },

  ['@parties/updateLeaderChange'](state, action) {
    const { partyId, leader, time } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    state.current.leader = leader
    addMessage(
      state.current,
      new PartyLeaderChangeMessageRecord({
        id: cuid(),
        time,
        userId: leader,
      }),
    )
  },

  ['@parties/updateChatMessage'](state, action) {
    const { message } = action.payload

    if (message.partyId !== state.current?.id) {
      return
    }

    addMessage(
      state.current,
      new TextMessageRecord({
        id: cuid(),
        from: message.user.id,
        time: message.time,
        text: message.text,
      }),
    )
  },

  ['@parties/updateKick'](state, action) {
    const { partyId, target, time } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    const index = state.current.members.findIndex(id => id === target)
    if (index !== -1) {
      state.current.members.splice(index, 1)
      addMessage(
        state.current,
        new KickFromPartyMessageRecord({
          id: cuid(),
          time,
          userId: target,
        }),
      )
    }
  },

  ['@parties/updateKickSelf'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.current?.id) {
      return state
    }

    return DEFAULT_STATE
  },

  ['@parties/activateParty'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    state.current.hasUnread = false
    state.current.activated = true
  },

  ['@parties/deactivateParty'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.current?.id) {
      return
    }

    state.current.messages = state.current.messages.slice(-INACTIVE_PARTY_MAX_HISTORY)
    state.current.activated = false
  },

  ['@parties/updateQueue'](
    state,
    { payload: { partyId, queueId, matchmakingType, accepted, unaccepted, time } },
  ) {
    if (partyId !== state.current?.id) {
      return
    }

    if (!state.current.queueState || state.current.queueState.id !== queueId) {
      state.current.queueState = {
        id: queueId,
        matchmakingType,
        accepted: new Map(accepted),
        unaccepted: new Set(unaccepted),
      }
      addMessage(
        state.current,
        new PartyQueueStartMessageRecord({
          id: cuid(),
          time,
          leaderId: state.current.leader,
          matchmakingType,
        }),
      )
    } else {
      const { queueState } = state.current
      queueState.matchmakingType = matchmakingType

      for (const [userId, race] of accepted) {
        queueState.accepted.set(userId, race)
        queueState.unaccepted.delete(userId)
      }

      for (const userId of unaccepted) {
        queueState.unaccepted.add(userId)
        queueState.accepted.delete(userId)
      }
    }
  },

  ['@parties/updateQueueCancel'](state, { payload: { partyId, queueId, reason, time } }) {
    if (partyId !== state.current?.id || queueId !== state.current.queueState?.id) {
      return
    }

    state.current.queueState = undefined
    addMessage(
      state.current,
      new PartyQueueCancelMessageRecord({
        id: cuid(),
        time,
        reason,
      }),
    )
  },

  ['@parties/updateQueueReady'](state, { payload: { partyId, queueId, time } }) {
    if (partyId !== state.current?.id || queueId !== state.current.queueState?.id) {
      return
    }

    state.current.queueState = undefined
    addMessage(
      state.current,
      new PartyQueueReadyMessageRecord({
        id: cuid(),
        time,
      }),
    )
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return DEFAULT_STATE
  },
})
