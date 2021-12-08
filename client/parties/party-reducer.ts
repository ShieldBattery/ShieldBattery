import cuid from 'cuid'
import { List, OrderedSet, Record } from 'immutable'
import { SbUserId } from '../../common/users/user-info'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { Message, TextMessageRecord } from '../messaging/message-records'
import { keyedReducer } from '../reducers/keyed-reducer'
import {
  InviteToPartyMessageRecord,
  JoinPartyMessageRecord,
  KickFromPartyMessageRecord,
  LeavePartyMessageRecord,
  PartyLeaderChangeMessageRecord,
  SelfJoinPartyMessageRecord,
} from './party-message-records'

// How many messages should be kept when a party is inactive
const INACTIVE_PARTY_MAX_HISTORY = 500

export class PartyState extends Record({
  id: '',
  invites: OrderedSet<SbUserId>(),
  members: OrderedSet<SbUserId>(),
  leader: 0 as SbUserId,
  messages: List<Message>(),
  hasUnread: false,
  activated: false,
}) {}

export default keyedReducer(new PartyState(), {
  ['@parties/init'](state, action) {
    const {
      party: { id, invites, members, leader },
      time,
    } = action.payload

    return new PartyState({
      id,
      invites: OrderedSet(invites),
      members: OrderedSet(members),
      leader,
      messages: List([
        new SelfJoinPartyMessageRecord({
          id: cuid(),
          time,
          leaderId: leader,
        }),
      ]),
    })
  },

  ['@parties/updateInvite'](state, action) {
    const { partyId, invitedUser, time } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .set('invites', state.invites.add(invitedUser))
      .set('hasUnread', !state.activated)
      .update('messages', messages =>
        messages.push(
          new InviteToPartyMessageRecord({
            id: cuid(),
            time,
            userId: invitedUser,
          }),
        ),
      )
  },

  ['@parties/updateUninvite'](state, action) {
    const { partyId, target } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.set('invites', state.invites.delete(target))
  },

  ['@parties/updateJoin'](state, action) {
    const { partyId, user, time } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .set('invites', state.invites.delete(user))
      .set('members', state.members.add(user))
      .set('hasUnread', !state.activated)
      .update('messages', messages =>
        messages.push(
          new JoinPartyMessageRecord({
            id: cuid(),
            time,
            userId: user,
          }),
        ),
      )
  },

  ['@parties/updateLeave'](state, action) {
    const { partyId, user, time } = action.payload

    if (partyId !== state.id) {
      return state
    }

    // This action can be dispatched *after* a player gets kicked as well, in which case there's no
    // need to do any cleanup, nor display a "leave" message.
    if (state.members.has(user)) {
      return state
        .set('members', state.members.delete(user))
        .set('hasUnread', !state.activated)
        .update('messages', messages =>
          messages.push(
            new LeavePartyMessageRecord({
              id: cuid(),
              time,
              userId: user,
            }),
          ),
        )
    } else {
      return state
    }
  },

  ['@parties/updateLeaveSelf'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return new PartyState()
  },

  ['@parties/updateLeaderChange'](state, action) {
    const { partyId, leader, time } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .set('leader', leader)
      .set('hasUnread', !state.activated)
      .update('messages', messages =>
        messages.push(
          new PartyLeaderChangeMessageRecord({
            id: cuid(),
            time,
            userId: leader,
          }),
        ),
      )
  },

  ['@parties/updateChatMessage'](state, action) {
    const { message } = action.payload

    if (message.partyId !== state.id) {
      return state
    }

    return state.set('hasUnread', !state.activated).update('messages', messages =>
      messages.push(
        new TextMessageRecord({
          id: cuid(),
          from: message.user.id,
          time: message.time,
          text: message.text,
        }),
      ),
    )
  },

  ['@parties/updateKick'](state, action) {
    const { partyId, target, time } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .set('members', state.members.delete(target))
      .set('hasUnread', !state.activated)
      .update('messages', messages =>
        messages.push(
          new KickFromPartyMessageRecord({
            id: cuid(),
            time,
            userId: target,
          }),
        ),
      )
  },

  ['@parties/updateKickSelf'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return new PartyState()
  },

  ['@parties/activateParty'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.set('hasUnread', false).set('activated', true)
  },

  ['@parties/deactivateParty'](state, action) {
    const { partyId } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .set('messages', state.messages.slice(-INACTIVE_PARTY_MAX_HISTORY))
      .set('activated', false)
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return new PartyState()
  },
})
