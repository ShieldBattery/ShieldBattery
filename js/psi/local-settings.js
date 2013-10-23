var fs = require('fs')

module.exports = function(filepath) {
  if (!fs.existsSync(filepath)) {
    createSettingsFileSync(filepath)
  }

  return new LocalSettings(filepath)
}

function createSettingsFileSync(filepath) {
  // create an object with any "generated defaults" (e.g. a randomized port)
  var settings =  { bwPort: genRandomPort()
                  }
  fs.writeFileSync(filepath, jsonify(settings), { encoding: 'utf8' })
}

var PORT_RANGE_START = 49152
  , PORT_RANGE_END = 65535
function genRandomPort() {
  return Math.round(Math.random() * (PORT_RANGE_END - PORT_RANGE_START)) + PORT_RANGE_START
}

function jsonify(settings) {
  return JSON.stringify(settings, null, 2)
}

function LocalSettings(filepath) {
  this._filepath = filepath
  try {
    this._settings = JSON.parse(fs.readFileSync(filepath, { encoding: 'utf8' }))
  } catch (err) {
    console.log('Error parsing settings file: ' + err)
  }
  if (!this._settings) {
    throw new Error('Could not read settings file')
  }

  this._watcher = fs.watch(filepath, this.onFileChange.bind(this))
}

LocalSettings.prototype.onFileChange = function(event) {
  if (event == 'change') {
    fs.readFile(this._filepath, { encoding: 'utf8' }, this.onFileContents.bind(this))
  }
}

LocalSettings.prototype.onFileContents = function(err, data) {
  if (err) {
    console.log('Error getting settings file contents: ' + err)
    return
  }

  try {
    this._settings = JSON.parse(data)
    console.log('got new settings: ' + JSON.stringify(this._settings))
  } catch (err) {
    console.log('Error parsing settings file: ' + err)
  }
}

LocalSettings.prototype.stopWatching = function() {
  if (this._watcher) {
    this._watcher.close()
    this._watcher = null
  }
}

LocalSettings.prototype.getSettings = function() {
  return this._settings
}

LocalSettings.prototype.setSettings = function(settings) {
  this._settings = settings
  fs.writeFile(this._filepath, jsonify(this._settings), { encoding: 'utf8' }, function(err) {
    if (err) {
      console.log('Error writing to settings file: ' + err)
    }
  })
}
