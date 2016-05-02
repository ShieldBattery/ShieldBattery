export function parseVersion(versionStr) {
  const parts = versionStr.split('.', 3).map(str => parseInt(str, 10))
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
  }
}

// Returns -1 if A < B, 0 if A == B, 1 if A > B
function compareVersions(versionA, versionB) {
  if (versionA.major !== versionB.major) {
    return versionA.major < versionB.major ? -1 : 1
  }
  if (versionA.minor !== versionB.minor) {
    return versionA.minor < versionB.minor ? -1 : 1
  }
  if (versionA.patch !== versionB.patch) {
    return versionA.patch < versionB.patch ? -1 : 1
  }

  return 0
}

export function needsUpgrade({ network, upgrade }) {
  if (!upgrade.minVersion.major && !upgrade.minVersion.minor && !upgrade.minVersion.patch) {
    return false
  }

  return compareVersions(network.psi.version, upgrade.minVersion) < 0
}
