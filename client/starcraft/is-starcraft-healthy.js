export function hasValidStarcraftPath({ starcraft }) {
  return starcraft.pathValid
}

export function hasValidStarcraftVersion({ starcraft }) {
  return starcraft.versionValid
}

export function isStarcraftHealthy({ starcraft }) {
  return hasValidStarcraftPath({ starcraft }) && hasValidStarcraftVersion({ starcraft })
}

export function isShieldBatteryHealthy({ starcraft }) {
  return starcraft.shieldBattery.init && starcraft.shieldBattery.main
}
