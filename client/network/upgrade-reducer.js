import { Record } from 'immutable'
import {
  UPGRADE_PSI_INFO,
} from '../actions'
import { parseVersion } from './needs-upgrade'

export const UpgradeInfo = new Record({
  minVersion: parseVersion('0.0.0'),
  installerUrl: null,
})

export default function upgradeReducer(state = new UpgradeInfo(), action) {
  if (action.type === UPGRADE_PSI_INFO) {
    return new UpgradeInfo({
      minVersion: parseVersion(action.payload.minVersion),
      installerUrl: action.payload.installerUrl,
    })
  }

  return state
}
