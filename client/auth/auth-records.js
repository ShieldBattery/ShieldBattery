import { Record } from 'immutable'

export const User = new Record({ id: null, name: null })
export const Permissions = new Record({
  editPermissions: false,
  debug: false,
  acceptInvites: false,
  editAllChannels: false,
  banUsers: false,
  manageMaps: false,
  manageStarcraftPatches: false,
})
export const Auth = new Record({
  authChangeInProgress: false,
  lastFailure: null,
  user: new User(),
  permissions: new Permissions(),
})

export function fromJS(jsObj) {
  return new Auth({
    user: new User(jsObj.user),
    permissions: new Permissions(jsObj.permissions),
  })
}
