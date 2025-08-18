import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../../common/users/permissions'
import { ClientRestrictionInfo, RestrictionKind } from '../../common/users/restrictions'
import { SelfUserJson } from '../../common/users/sb-user'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface AuthState {
  self?: {
    user: SelfUserJson
    permissions: SbPermissions
    restrictions: Map<RestrictionKind, ClientRestrictionInfo>
  }
}

const DEFAULT_STATE: ReadonlyDeep<AuthState> = {
  self: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@auth/logOut']() {
    return DEFAULT_STATE
  },
  ['@auth/loadCurrentSession'](state, { payload: { user, permissions } }) {
    state.self = {
      user: { ...user },
      permissions: { ...permissions },
      // NOTE(tec27): This is currently safe because we can guarantee we won't have a websocket
      // connection (where we receive restrictions from) until after we load a session. If that
      // stops being the case, this will need to change to sometimes not clear this
      restrictions: new Map<RestrictionKind, ClientRestrictionInfo>(),
    }
  },
  ['@auth/emailChanged'](state, { payload: { email } }) {
    state.self!.user.email = email
    state.self!.user.emailVerified = false
  },
  ['@auth/emailVerified'](state) {
    state.self!.user.emailVerified = true
  },
  ['@auth/acceptPolicies'](state, action) {
    state.self!.user = { ...action.payload.user }
  },
  ['@auth/changeLanguage'](state, action) {
    state.self!.user = { ...action.payload.user }
  },
  ['@auth/permissionsChanged'](state, action) {
    state.self!.permissions = { ...action.payload.permissions }
  },
  ['@auth/sessionUnauthorized']() {
    return DEFAULT_STATE
  },
  ['@auth/restrictionsChanged'](state, { payload: { restrictions } }) {
    state.self!.restrictions.clear()
    for (const restriction of restrictions) {
      state.self!.restrictions.set(restriction.kind, restriction)
    }
  },
  ['@auth/clearRestriction'](state, { payload: { restriction } }) {
    const existing = state.self?.restrictions.get(restriction.kind)
    if (existing?.endTime === restriction.endTime) {
      state.self!.restrictions.delete(restriction.kind)
    }
  },
  ['@auth/displayNameChanged'](state, { payload: { newDisplayName } }) {
    if (state.self) {
      state.self.user.name = newDisplayName
    }
  },
})
