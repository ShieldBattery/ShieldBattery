import type { SbPermissions } from '../typeshare'

// Re-exported as a type only: `SbPermissions` is an interface, and a value re-export would make
// bundlers that transform files in isolation (e.g. esbuild/Vite) emit a runtime import of the
// generated typeshare module, which has no runtime exports to provide.
export type { SbPermissions }

export type PermissionName = keyof SbPermissions

export const DEFAULT_PERMISSIONS: Readonly<SbPermissions> = {
  editPermissions: false,
  debug: false,
  banUsers: false,
  manageLeagues: false,
  manageMaps: false,
  manageMapPools: false,
  manageMatchmaking: false,
  manageMatchmakingSeasons: false,
  manageMatchmakingTimes: false,
  massDeleteMaps: false,
  moderateChatChannels: false,
  manageNews: false,
  manageBugReports: false,
  manageGameReports: false,
  manageRestrictedNames: false,
  manageSignupCodes: false,
  manageLiveStreams: false,
}
