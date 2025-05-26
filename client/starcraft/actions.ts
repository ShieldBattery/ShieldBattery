import { ShieldBatteryFileResult } from '../../common/shieldbattery-file'

export type StarcraftActions =
  | StarcraftPathValidity
  | StarcraftVersionValidity
  | ShieldBatteryFilesValidity

export interface StarcraftPathValidity {
  type: '@starcraft/pathValidity'
  payload: boolean
}

export interface StarcraftVersionValidity {
  type: '@starcraft/versionValidity'
  payload: boolean
}

export interface ShieldBatteryFilesValidity {
  type: '@starcraft/shieldBatteryFilesValidity'
  payload: ShieldBatteryFileResult[]
}
