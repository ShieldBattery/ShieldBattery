function makeMapStore() {
  if (process.webpackEnv.SB_ENV !== 'electron') {
    return null
  }

  const MapStore = require('./map-store').default
  const path = require('path')
  const { remote } = require('electron')

  const mapDirPath = path.join(remote.app.getPath('userData'), 'maps')
  return new MapStore(mapDirPath)
}

export default makeMapStore()
