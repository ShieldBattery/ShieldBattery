import fs from 'fs'
import { EventEmitter } from 'events'
import deepEqual from 'deep-equal'
import log from './logger'

class LocalSettings extends EventEmitter {
  constructor(filepath) {
    super()
    this._filepath = filepath
    try {
      this._settings = JSON.parse(fs.readFileSync(filepath, { encoding: 'utf8' }))
    } catch (err) {
      log.error('Error parsing settings file: ' + err)
    }
    if (!this._settings) {
      throw new Error('Could not read settings file')
    }

    this._watcher = this._createWatcher(filepath)
  }

  // Pulled out due to the bug in babel arrow function transformer that screws with super() calls
  _createWatcher(filepath) {
    return fs.watch(filepath, event => this.onFileChange(event))
  }

  onFileChange(event) {
    if (event === 'change') {
      fs.readFile(this._filepath, { encoding: 'utf8' },
          (err, data) => this.onFileContents(err, data))
    }
  }

  onFileContents(err, data) {
    if (err) {
      log.error('Error getting settings file contents: ' + err)
      return
    }

    try {
      const newData = JSON.parse(data)
      if (!deepEqual(newData, this._settings)) {
        this._settings = newData
        this.emit('change')
      }
      log.verbose('Got new settings: ' + JSON.stringify(this._settings))
    } catch (err) {
      log.error('Error parsing settings file: ' + err)
    }
  }

  stopWatching() {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  }

  get settings() {
    return this._settings
  }

  set settings(newSettings) {
    if (deepEqual(newSettings, this._settings)) {
      return
    }

    this._settings = newSettings
    fs.writeFile(this._filepath, jsonify(this._settings), { encoding: 'utf8' }, err => {
      if (err) {
        log.error('Error writing to settings file: ' + err)
      }
    })
    this.emit('change')
  }
}

export default function(filepath) {
  if (!fs.existsSync(filepath)) {
    createSettingsFileSync(filepath)
  }

  return new LocalSettings(filepath)
}

function createSettingsFileSync(filepath) {
  // create an object with any "generated defaults" (e.g. a randomized port)
  const settings = {
    bwPort: genRandomPort()
  }
  fs.writeFileSync(filepath, jsonify(settings), { encoding: 'utf8' })
}

function genRandomPort() {
  // TODO(tec27): re-enable random code once we have UPNP/holepunching
  return 6112
}

function jsonify(settings) {
  return JSON.stringify(settings, null, 2)
}
