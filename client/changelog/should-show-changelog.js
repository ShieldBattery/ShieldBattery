export const VERSION = process.webpackEnv.VERSION
const PARSED_VERSION = VERSION.split('.').map(str => +str)
export const KEY = 'shieldBatteryVersion'

export function shouldShowChangelog() {
  const val = window.localStorage.getItem(KEY)
  if (val) {
    const parsed = val.split('.').map(str => +str)
    if (
      parsed[0] >= PARSED_VERSION[0] &&
      parsed[1] >= PARSED_VERSION[1] &&
      parsed[2] >= PARSED_VERSION[2]
    ) {
      return false
    }
  }

  return true
}
