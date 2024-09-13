import { Record } from 'immutable'
import { ShieldBatteryFile } from '../../common/shieldbattery-file.js'
import {
  SHIELDBATTERY_FILES_VALIDITY,
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_VERSION_VALIDITY,
} from '../actions.js'
import { keyedReducer } from '../reducers/keyed-reducer.js'

export class ShieldBatteryFileStatus extends Record({
  init: false,
  main: false,
}) {}

export class StarcraftStatus extends Record({
  pathValid: false,
  versionValid: false,
  shieldBattery: new ShieldBatteryFileStatus(),
}) {}

export default keyedReducer(new StarcraftStatus(), {
  [STARCRAFT_PATH_VALIDITY as any](state: StarcraftStatus, action: any) {
    return state.set('pathValid', action.payload)
  },

  [STARCRAFT_VERSION_VALIDITY as any](state: StarcraftStatus, action: any) {
    return state.set('versionValid', action.payload)
  },

  [SHIELDBATTERY_FILES_VALIDITY as any](state: StarcraftStatus, action: any) {
    const resultsMap = new Map<ShieldBatteryFile, boolean>(action.payload)

    return state.set(
      'shieldBattery',
      new ShieldBatteryFileStatus({
        init: resultsMap.get(ShieldBatteryFile.Init) ?? false,
        main: resultsMap.get(ShieldBatteryFile.Main) ?? false,
      }),
    )
  },
})
