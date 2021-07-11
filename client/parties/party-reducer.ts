import cuid from 'cuid'
import { List, OrderedMap, Record } from 'immutable'
import { PartyUser } from '../../common/parties'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { Message, TextMessageRecord } from '../messaging/message-records'
import { keyedReducer } from '../reducers/keyed-reducer'
import {
  InviteToPartyMessageRecord,
  JoinPartyMessageRecord,
  LeavePartyMessageRecord,
  SelfJoinPartyMessageRecord,
} from './party-message-records'

// How many messages should be kept when a party is inactive
const INACTIVE_PARTY_MAX_HISTORY = 500

export class PartyUserRecord
  extends Record({
    id: 0,
    name: '',
  })
  implements PartyUser {}

export class PartyRecord extends Record({
  id: '',
  invites: OrderedMap<number, PartyUser>(),
  members: OrderedMap<number, PartyUser>(),
  leader: new PartyUserRecord(),
  messages: List<Message>(),
  hasUnread: false,
  activated: false,
}) {}

export default keyedReducer(new PartyRecord(), {
  ['@parties/init'](state, action) {
    const {
      party: { id, invites, members, leader },
      time,
    } = action.payload

    return new PartyRecord({
      id,
      invites: OrderedMap(invites.map(i => [i.id, new PartyUserRecord(i)])),
      members: OrderedMap(members.map(m => [m.id, new PartyUserRecord(m)])),
      leader: new PartyUserRecord(leader),
      messages: List([
        new SelfJoinPartyMessageRecord({
          id: cuid(),
          time,
          leaderId: leader.id,
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
      .setIn(['invites', invitedUser.id], new PartyUserRecord(invitedUser))
      .set('hasUnread', !state.activated)
      .update('messages', messages =>
        messages.push(
          new InviteToPartyMessageRecord({
            id: cuid(),
            time,
            userId: invitedUser.id,
          }),
        ),
      )
  },

  ['@parties/updateUninvite'](state, action) {
    const { partyId, target } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.deleteIn(['invites', target.id])
  },

  ['@parties/updateDecline'](state, action) {
    const { partyId, target } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.deleteIn(['invites', target.id])
  },

  ['@parties/updateJoin'](state, action) {
    const { partyId, user, time } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .deleteIn(['invites', user.id])
      .setIn(['members', user.id], new PartyUserRecord(user))
      .set('hasUnread', !state.activated)
      .update('messages', messages =>
        messages.push(
          new JoinPartyMessageRecord({
            id: cuid(),
            time,
            userId: user.id,
          }),
        ),
      )
  },

  ['@parties/updateLeave'](state, action) {
    const { partyId, user, time } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .deleteIn(['members', user.id])
      .set('hasUnread', !state.activated)
      .update('messages', messages =>
        messages.push(
          new LeavePartyMessageRecord({
            id: cuid(),
            time,
            userId: user.id,
          }),
        ),
      )
  },

  ['@parties/updateChatMessage'](state, action) {
    const { partyId, from, time, text } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.set('hasUnread', !state.activated).update('messages', messages =>
      messages.push(
        new TextMessageRecord({
          id: cuid(),
          from: from.id,
          time,
          text,
        }),
      ),
    )
  },

  ['@parties/updateLeaveSelf'](state, action) {
    return new PartyRecord()
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
    return new PartyRecord()
  },
})
