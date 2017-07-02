let mapStore
if (IS_ELECTRON) {
  const MapStore = require('./map-store').default
  const path = require('path')
  const { remote } = require('electron')

  const mapDirPath = path.join(remote.app.getPath('userData'), 'maps')
  mapStore = new MapStore(mapDirPath)
}

export default mapStore
