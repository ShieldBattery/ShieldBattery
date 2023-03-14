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

export const DEFAULT_PERMISSIONS: Readonly<SbPermissions> = {
  editPermissions: false,
  debug: false,
  banUsers: false,
  manageLeagues: false,
  manageMaps: false,
  manageMapPools: false,
  manageMatchmakingSeasons: false,
  manageMatchmakingTimes: false,
  manageRallyPointServers: false,
  massDeleteMaps: false,
  moderateChatChannels: false,
}

export const userPermissions = { ...DEFAULT_PERMISSIONS }
