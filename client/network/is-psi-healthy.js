import { needsUpgrade } from './needs-upgrade'

export function isPsiConnected({ network }) {
  return network.psi.isConnected
}

export function isPsiUpToDate({ network, upgrade }) {
  return !needsUpgrade({ network, upgrade })
}

export function hasValidStarcraftPath({ network }) {
  return network.psi.hasValidStarcraftPath
}

export function hasValidStarcraftVersion({ network }) {
  return network.psi.hasValidStarcraftVersion
}

export function isPsiHealthy({ network, upgrade }) {
  return (isPsiConnected({ network }) &&
      isPsiUpToDate({ network, upgrade }) &&
      hasValidStarcraftPath({ network }) &&
      hasValidStarcraftVersion({ network }))
}
