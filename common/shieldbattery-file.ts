/**
 * An identifier of a particular file that is important to ShieldBattery's execution.
 */
export enum ShieldBatteryFile {
  /** game/dist/sb_init.dll */
  Init,
  /** game/dist/shieldbattery.dll */
  Main,
}

export type ShieldBatteryFileResult = [file: ShieldBatteryFile, canAccess: boolean]
