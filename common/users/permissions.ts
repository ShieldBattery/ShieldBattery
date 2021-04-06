export interface Permissions {
  editPermissions: boolean
  debug: boolean
  acceptInvites: boolean
  editAllChannels: boolean
  banUsers: boolean
  manageMaps: boolean
  manageMapPools: boolean
  manageMatchmakingTimes: boolean
  manageRallyPointServers: boolean
  massDeleteMaps: boolean
}

export type PermissionName = keyof Permissions
