import { Record } from 'immutable'
import { UserInfo } from '../../common/users/user-info'

export const User = Record({
  id: null as number | null,
  name: null as string | null,
  email: null as string | null,
})

export const Permissions = Record({
  editPermissions: false,
  debug: false,
  acceptInvites: false,
  editAllChannels: false,
  banUsers: false,
  manageMaps: false,
  manageMapPools: false,
  massDeleteMaps: false,
  manageMatchmakingTimes: false,
})

export const Auth = Record({
  authChangeInProgress: false,
  emailVerified: false,
  lastFailure: null as { reqId: string; err: string } | null,
  user: new User(),
  permissions: new Permissions(),
})

export function fromJs(jsObj: UserInfo) {
  return new Auth({
    user: new User(jsObj.user),
    permissions: new Permissions(jsObj.permissions),
    emailVerified: !!jsObj.user.emailVerified,
  })
}
