import { SbPermissions } from '../typeshare.js'

export { SbPermissions }

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
  manageNews: false,
  manageBugReports: false,
}
