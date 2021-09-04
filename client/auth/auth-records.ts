import { Record } from 'immutable'
import { SbPermissions } from '../../common/users/permissions'

export class SelfUserRecord extends Record({
  id: -1,
  name: '',
  email: '',
  emailVerified: false,
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
  })
  implements SbPermissions {}

export class AuthState extends Record({
  authChangeInProgress: false,
  lastFailure: null as { reqId: string; err: string } | null,
  user: new SelfUserRecord(),
  permissions: new PermissionsRecord(),
}) {}
