import { List, Map, Record } from 'immutable'
import { PartyUser } from '../../common/parties'
import keyedReducer from '../reducers/keyed-reducer'

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

export class PartyInvite extends Record({
  partyId: '',
  from: new PartyUserRecord(),
}) {}

export class PartiesState extends Record({
  party: new PartyRecord(),
  invites: Map<string, typeof PartyInvite>(),
}) {}

export default keyedReducer(new PartiesState(), {
  ['@parties/addInvite'](state, action) {
    const { partyId, from } = action.payload

    return state.setIn(
      ['invites', partyId],
      new PartyInvite({
        partyId,
        from: new PartyUserRecord(from),
      }),
    )
  },

  ['@parties/removeInvite'](state, action) {
    return state.deleteIn(['invites', action.payload.partyId])
  },

  ['@parties/init'](state, action) {
    const {
      party: { id, invites, members, leader },
    } = action.payload

    return state.deleteIn(['invites', id]).set(
      'party',
      new PartyRecord({
        id,
        invites: Map(invites.map(i => [i.id, new PartyUserRecord(i)])),
        members: Map(members.map(m => [m.id, new PartyUserRecord(m)])),
        leader: new PartyUserRecord(leader),
      }),
    )
  },

  ['@parties/invite'](state, action) {
    const { invites } = action.payload

    return state.updateIn(['party', 'invites'], i =>
      i.merge(invites.map(invite => [invite.id, new PartyUserRecord(invite)])),
    )
  },

  ['@parties/decline'](state, action) {
    const { target } = action.payload

    return state.deleteIn(['party', 'invites', target.id])
  },

  ['@parties/join'](state, action) {
    const { user } = action.payload

    return state
      .deleteIn(['party', 'invites', user.id])
      .setIn(['party', 'members', user.id], new PartyUserRecord(user))
  },

  ['@parties/leave'](state, action) {
    const { user } = action.payload

    return state.deleteIn(['party', 'members', user.id])
  },
})
