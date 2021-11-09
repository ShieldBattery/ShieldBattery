import { Record } from 'immutable'
import { SbPermissions } from '../../common/users/permissions'
import { SbUserId } from '../../common/users/user-info'

export class SelfUserRecord extends Record({
  id: -1 as SbUserId,
  name: '',
  email: '',
  emailVerified: false,
  acceptedPrivacyVersion: 0,
  acceptedTermsVersion: 0,
  acceptedUsePolicyVersion: 0,
}) {}

export class PermissionsRecord
  extends Record({
    editPermissions: false,
    debug: false,
    acceptInvites: false,
    editAllChannels: false,
    banUsers: false,
    manageMaps: false,
    manageMapPools: false,
    manageMatchmakingTimes: false,
    manageRallyPointServers: false,
    massDeleteMaps: false,
    moderateChatChannels: false,
  })
  implements SbPermissions {}

export class AuthState extends Record({
  authChangeInProgress: false,
  lastFailure: null as { reqId: string; err: string } | null,
  user: new SelfUserRecord(),
  permissions: new PermissionsRecord(),
}) {}
