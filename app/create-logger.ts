import { app } from 'electron'
import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'

interface LoggerOptions {
  /** How many bytes should be written to the log file before it is rolled over. */
  rolloverSize: number
  /** The maximum number of rolled-over files to keep around. */
  maxRollovers: number
  /** What log levels to log. */
  logLevels: string[]
}

// the rolloverSize is only looked at when opening the file for logging, it is not an absolute
// guarantee that the log file will never be above that size
const defaultOptions: LoggerOptions = {
  rolloverSize: 1024 * 1024, // in bytes
  maxRollovers: 3,
  logLevels: ['warning', 'error'],
}
const possibleLevels = ['verbose', 'info', 'debug', 'warning', 'error']

export default function createLogger(baseFilename: string, options: Partial<LoggerOptions> = {}) {
  const actualOptions: LoggerOptions = {
    ...defaultOptions,
    ...options,
  }

  for (const level of actualOptions.logLevels) {
    if (!possibleLevels.includes(level)) throw new Error('Invalid log level: ' + level)
  }

  return new Logger(baseFilename, actualOptions)
}

class Logger {
  private options: LoggerOptions
  private filename: string

  private out: fs.WriteStream
  private buffer: string[] = []
  private opened = false
  private draining = false

  constructor(baseFilename: string, actualOptions: LoggerOptions) {
    this.options = actualOptions
    this.filename = baseFilename + '.0.log'

    this.options.logLevels.push('system')

    mkdirp.sync(path.dirname(this.filename), 0o777)

    let stats
    try {
      stats = fs.statSync(this.filename)
    } catch (e) {
      // file doesn't exist, so we can just create it
    }

    if (stats && stats.size >= this.options.rolloverSize) {
      rollover(baseFilename, this.options.maxRollovers)
    }

    this.out = fs.createWriteStream(this.filename, { flags: 'a', encoding: 'utf8' })

    this.out.on('open', () => {
      this.opened = true
      while (this.buffer.length) {
        const msg = this.buffer.shift()
        const result = this.out.write(msg)
        if (!result) {
          this.handleDrain()
          return
        }
      }
    })

    this.writeToLog('\n\n')
    this.system('Logging started')
    this.system('Version: ' + app.getVersion())
  }

  log = (level: string, msg: string) => {
    if (!this.options.logLevels.includes(level)) {
      return
    }
    this.writeToLog(`[${new Date().toISOString()}]\t<${level}>\t${msg}\n`)
  }

  verbose = (msg: string) => {
    this.log('verbose', msg)
  }

  info = (msg: string) => {
    this.log('info', msg)
  }

  debug = (msg: string) => {
    this.log('debug', msg)
  }

  warning = (msg: string) => {
    this.log('warning', msg)
  }

  warn = (msg: string) => {
    this.warning(msg)
  }

  error = (msg: string) => {
    this.log('error', msg)
  }

  private writeToLog(outStr: string) {
    if (this.draining || !this.opened) {
      this.buffer.push(outStr)
    } else {
      const result = this.out.write(outStr)
      if (!result) {
        this.handleDrain()
      }
    }
  }

  private handleDrain() {
    this.draining = true
    this.out.once('drain', () => {
      while (this.buffer.length) {
        const msg = this.buffer.shift()
        const result = this.out.write(msg)
        if (!result) {
          this.handleDrain()
          return
        }
      }

      this.draining = false
    })
  }

  private system(msg: string) {
    this.log('system', msg)
  }
}

function rollover(baseFilename: string, maxRollovers: number) {
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
