// TODO(tec27): Rename this file and the main function

export function hasValidStarcraftPath({ starcraft }) {
  return starcraft.pathValid
}

export function hasValidStarcraftVersion({ starcraft }) {
  return starcraft.versionValid
}

export function isPsiHealthy({ starcraft }) {
  return (hasValidStarcraftPath({ starcraft }) &&
      hasValidStarcraftVersion({ starcraft }))
}
