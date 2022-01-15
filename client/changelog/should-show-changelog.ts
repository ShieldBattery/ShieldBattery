import semverCompare from 'semver-compare'

export const VERSION = __WEBPACK_ENV.VERSION
export const KEY = 'shieldBatteryVersion'

export function shouldShowChangelog() {
  const val = window.localStorage.getItem(KEY)
  if (val) {
    return semverCompare(val, VERSION) < 0
  }

  return true
}
