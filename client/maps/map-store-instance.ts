import type { MapStore } from './map-store'

let mapStore: MapStore | undefined
if (IS_ELECTRON) {
  const { MapStore } = require('./map-store')
  const path = require('path')
  const { remote } = require('electron')

  const mapDirPath = path.join(remote.app.getPath('userData'), 'maps')
  mapStore = new MapStore(mapDirPath)
}

export default mapStore
