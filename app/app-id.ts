let appId = 'net.shieldbattery.client'

export function setAppId(id: string) {
  appId = id
}

/**
 * Returns the current identifier for the Application/version (e.g. net.shieldbattery.client).
 * This will be used by the Operating System to uniquely identify this installation of
 * ShieldBattery.
 */
export function getAppId() {
  return appId
}
