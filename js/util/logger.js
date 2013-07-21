var fs = require('fs')
  , path = require('path')
  , mkdirp = require('mkdirp')

// the rolloverSize is only looked at when opening the file for logging, it is not an absolute
// guarantee that the log file will never be above that size
var defaultOptions =  { rolloverSize: 1024*1024 // in bytes
                      , maxRollovers: 3
                      , logLevels: [ 'warning', 'error' ]
                      }
  , possibleLevels = [ 'verbose', 'debug', 'warning', 'error' ]

module.exports = function(baseFilename, options) {
  var actualOptions = {}
  for (var key in defaultOptions) {
    actualOptions[key] = options[key] || defaultOptions[key]
  }

  actualOptions.logLevels.forEach(function(level) {
    if (possibleLevels.indexOf(level) == -1) throw new Error('Invalid log level: ' + level)
  })

  return new Logger(baseFilename, actualOptions)
}

function Logger(baseFilename, actualOptions) {
  this._options = actualOptions
  this._filename = baseFilename + '.0.log'

  this._options.logLevels.push('system')

  mkdirp.sync(path.dirname(this._filename))

  var stats
  try {
    stats = fs.statSync(this._filename)
  } catch(e) {
    // file doesn't exist, so we can just create it
  }

  if (stats && stats.size >= this._options.rolloverSize) {
    rollover(baseFilename,  this._options.maxRollovers)
  }

  this._out = fs.createWriteStream(this._filename, { flags: 'a', encoding: 'utf8' })
  this._buffer = []
  this._opened = false
  this._draining = false

  var self = this
  this._out.on('open', function() {
    self._opened = true
    while (self._buffer.length) {
      var msg = self._buffer.shift()
      var result = self._out.write(msg)
      if (!result) {
        self._handleDrain()
        return
      }
    }
  })

  this._system('Logging started')
}

Logger.prototype.log = function(level, msg) {
  if (this._options.logLevels.indexOf(level) == -1) return

  var outStr = '[' + (new Date().toISOString()) +']\t<' + level + '>\t' + msg + '\n'
  if (this._draining || !this._opened) {
    this._buffer.push(outStr)
  } else {
    var result = this._out.write(outStr)
    if (!result) {
      this._handleDrain()
    }
  }
}

Logger.prototype._handleDrain = function() {
  this._draining = true
  var self = this
  this._out.once('drain', function() {
    while (self._buffer.length) {
      var msg = self._buffer.shift()
      var result = self._out.write(msg)
      if (!result) {
        self._handleDrain()
        return
      }
    }

    self._draining = false
  })
}

possibleLevels.forEach(function(level) {
  Logger.prototype[level] = function(msg) {
    this.log(level, msg)
  }
})

Logger.prototype._system = function(msg) {
  this.log('system', msg)
}

function rollover(baseFilename, maxRollovers) {
  var lastFile = baseFilename + '.' + (maxRollovers - 1) + '.log'

  if (fs.existsSync(lastFile)) {
    fs.unlinkSync(lastFile)
  }
  for (var i = maxRollovers - 2; i >= 0; i--) {
    var src = baseFilename + '.' + i + '.log'
      , dest = baseFilename + '.' + (i + 1) + '.log'
    if (fs.exisitsSync(src)) {
      fs.renameSync(src, dest)
    }
  }
}
