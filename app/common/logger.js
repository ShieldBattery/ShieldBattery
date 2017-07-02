import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import packageJson from '../package.json'

// the rolloverSize is only looked at when opening the file for logging, it is not an absolute
// guarantee that the log file will never be above that size
const defaultOptions = {
  rolloverSize: 1024 * 1024, // in bytes
  maxRollovers: 3,
  logLevels: ['warning', 'error'],
}
const possibleLevels = ['verbose', 'info', 'debug', 'warning', 'error']

export default function createLogger(baseFilename, options) {
  const actualOptions = {}
  for (const key in defaultOptions) {
    actualOptions[key] = options[key] || defaultOptions[key]
  }

  for (const level of actualOptions.logLevels) {
    if (!possibleLevels.includes(level)) throw new Error('Invalid log level: ' + level)
  }

  return new Logger(baseFilename, actualOptions)
}

function Logger(baseFilename, actualOptions) {
  this._options = actualOptions
  this._filename = baseFilename + '.0.log'

  this._options.logLevels.push('system')

  mkdirp.sync(path.dirname(this._filename), 0o777)

  let stats
  try {
    stats = fs.statSync(this._filename)
  } catch (e) {
    // file doesn't exist, so we can just create it
  }

  if (stats && stats.size >= this._options.rolloverSize) {
    rollover(baseFilename, this._options.maxRollovers)
  }

  this._out = fs.createWriteStream(this._filename, { flags: 'a', encoding: 'utf8' })
  this._buffer = []
  this._opened = false
  this._draining = false

  this._out.on('open', () => {
    this._opened = true
    while (this._buffer.length) {
      const msg = this._buffer.shift()
      const result = this._out.write(msg)
      if (!result) {
        this._handleDrain()
        return
      }
    }
  })

  this._writeToLog('\n\n')
  this._system('Logging started')
  this._system('Version: ' + packageJson.version)
}

Logger.prototype._writeToLog = function(outStr) {
  if (this._draining || !this._opened) {
    this._buffer.push(outStr)
  } else {
    const result = this._out.write(outStr)
    if (!result) {
      this._handleDrain()
    }
  }
}

Logger.prototype.log = function(level, msg) {
  if (!this._options.logLevels.includes(level)) {
    return
  }
  this._writeToLog(`[${new Date().toISOString()}]\t<${level}>\t${msg}\n`)
}

Logger.prototype._handleDrain = function() {
  this._draining = true
  this._out.once('drain', () => {
    while (this._buffer.length) {
      const msg = this._buffer.shift()
      const result = this._out.write(msg)
      if (!result) {
        this._handleDrain()
        return
      }
    }

    this._draining = false
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
  const lastFile = baseFilename + '.' + (maxRollovers - 1) + '.log'

  if (fs.existsSync(lastFile)) {
    fs.unlinkSync(lastFile)
  }
  for (let i = maxRollovers - 2; i >= 0; i--) {
    const src = baseFilename + '.' + i + '.log'
    const dest = baseFilename + '.' + (i + 1) + '.log'
    if (fs.existsSync(src)) {
      fs.renameSync(src, dest)
    }
  }
}
