export interface SbPermissions {
  editPermissions: boolean
  debug: boolean
  banUsers: boolean
  manageLeagues: boolean
  manageMaps: boolean
  manageMapPools: boolean
  manageMatchmakingSeasons: boolean
  manageMatchmakingTimes: boolean
  manageRallyPointServers: boolean
  massDeleteMaps: boolean
  moderateChatChannels: boolean
}

export type PermissionName = keyof SbPermissions
