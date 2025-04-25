import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../../common/users/permissions'
import { SelfUser } from '../../common/users/sb-user'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface AuthState {
  self?: {
    user: SelfUser
    permissions: SbPermissions
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
    }
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
})
