import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../../common/users/permissions'
import { SelfUser } from '../../common/users/sb-user'
import { ClientSessionInfo } from '../../common/users/session'
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
  /** TODO(tec27): Figure out why this action type is not properly inferred */
  ['@auth/loadCurrentSession'](state, action: { payload: ClientSessionInfo }) {
    const { user, permissions } = action.payload
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
