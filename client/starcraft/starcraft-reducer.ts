import { ReadonlyDeep } from 'type-fest'
import { ShieldBatteryFile } from '../../common/shieldbattery-file'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface ShieldBatteryFileStatus {
  init: boolean
  main: boolean
}

export interface StarcraftStatus {
  pathValid: boolean
  versionValid: boolean
  shieldBattery: ShieldBatteryFileStatus
}

const DEFAULT_STATE: ReadonlyDeep<StarcraftStatus> = {
  pathValid: false,
  versionValid: false,
  shieldBattery: {
    init: false,
    main: false,
  },
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@starcraft/pathValidity'](state, action) {
    state.pathValid = action.payload
  },

  ['@starcraft/versionValidity'](state, action) {
    state.versionValid = action.payload
  },

  ['@starcraft/shieldBatteryFilesValidity'](state, action) {
    const resultsMap = new Map<ShieldBatteryFile, boolean>(action.payload)
    state.shieldBattery.init = resultsMap.get(ShieldBatteryFile.Init) ?? false
    state.shieldBattery.main = resultsMap.get(ShieldBatteryFile.Main) ?? false
  },
})
