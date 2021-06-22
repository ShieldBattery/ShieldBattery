import { List, Map, Record } from 'immutable'
import { PartyUser } from '../../common/parties'
import { keyedReducer } from '../reducers/keyed-reducer'

export class PartyUserRecord
  extends Record({
    id: 0,
    name: '',
  })
  implements PartyUser {}

export class PartyRecord extends Record({
  id: '',
  invites: Map<number, PartyUser>(),
  members: Map<number, PartyUser>(),
  leader: new PartyUserRecord(),
  messages: List(),
}) {}

export default keyedReducer(new PartyRecord(), {
  ['@parties/init'](state, action) {
    const {
      party: { id, invites, members, leader },
    } = action.payload

    return new PartyRecord({
      id,
      invites: Map(invites.map(i => [i.id, new PartyUserRecord(i)])),
      members: Map(members.map(m => [m.id, new PartyUserRecord(m)])),
      leader: new PartyUserRecord(leader),
    })
  },

  ['@parties/invite'](state, action) {
    const { partyId, invitedUser } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.setIn(['invites', invitedUser.id], new PartyUserRecord(invitedUser))
  },

  ['@parties/uninvite'](state, action) {
    const { partyId, target } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.deleteIn(['invites', target.id])
  },

  ['@parties/decline'](state, action) {
    const { partyId, target } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.deleteIn(['invites', target.id])
  },

  ['@parties/join'](state, action) {
    const { partyId, user } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state
      .deleteIn(['invites', user.id])
      .setIn(['members', user.id], new PartyUserRecord(user))
  },

  ['@parties/leave'](state, action) {
    const { partyId, user } = action.payload

    if (partyId !== state.id) {
      return state
    }

    return state.deleteIn(['members', user.id])
  },
})
