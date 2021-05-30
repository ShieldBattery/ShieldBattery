import { Record } from 'immutable'
import { ShieldBatteryFile } from '../../common/shieldbattery-file'
import {
  SHIELDBATTERY_FILES_VALIDITY,
  STARCRAFT_PATH_VALIDITY,
  STARCRAFT_REMASTERED_STATUS,
  STARCRAFT_VERSION_VALIDITY,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export const ShieldBatteryFileStatus = new Record({
  init: false,
  main: false,
})

export const StarcraftStatus = new Record({
  pathValid: false,
  versionValid: false,
  isRemastered: false,
  shieldBattery: ShieldBatteryFileStatus(),
})

export default keyedReducer(new StarcraftStatus(), {
  [STARCRAFT_PATH_VALIDITY](state, action) {
    return state.set('pathValid', action.payload)
  },

  [STARCRAFT_VERSION_VALIDITY](state, action) {
    return state.set('versionValid', action.payload)
  },

  [STARCRAFT_REMASTERED_STATUS](state, action) {
    return state.set('isRemastered', action.payload)
  },

  [SHIELDBATTERY_FILES_VALIDITY](state, action) {
    const resultsMap = new Map(action.payload)

    return state.set(
      'shieldBattery',
      ShieldBatteryFileStatus({
        init: resultsMap.get(ShieldBatteryFile.Init) ?? false,
        main: resultsMap.get(ShieldBatteryFile.Main) ?? false,
      }),
    )
  },
})
