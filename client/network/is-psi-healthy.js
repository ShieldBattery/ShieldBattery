export function isPsiConnected({ network }) {
  return network.psi.isConnected
}


export function hasValidStarcraftPath({ network }) {
  return network.psi.hasValidStarcraftPath
}

export function hasValidStarcraftVersion({ network }) {
  return network.psi.hasValidStarcraftVersion
}

export function isPsiHealthy({ network, upgrade }) {
  return (isPsiConnected({ network }) &&
      hasValidStarcraftPath({ network }) &&
      hasValidStarcraftVersion({ network }))
}
