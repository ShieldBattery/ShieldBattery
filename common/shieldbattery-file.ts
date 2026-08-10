/**
 * An identifier of a particular file that is important to ShieldBattery's execution.
 */
export enum ShieldBatteryFile {
  /** game/dist/sb_init.dll */
  Init,
  /** game/dist/shieldbattery.dll */
  Main,
  /** game/dist/sb_init_64.dll */
  Init64,
  /** game/dist/shieldbattery_64.dll */
  Main64,
}

export type ShieldBatteryFileResult = [file: ShieldBatteryFile, canAccess: boolean]
