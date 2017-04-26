import { remote } from 'electron'
import fs from 'fs'
import path from 'path'
import thenify from 'thenify'

const readFileAsync = thenify(fs.readFile)

const SOUND_PATH = path.join('assets', 'sounds')

const AVAILABLE_SOUNDS = {
  JOIN_ALERT: 0
}
const s = AVAILABLE_SOUNDS
const SOUND_FILES = {
  [s.JOIN_ALERT]: 'join-alert.opus'
}

export default class AudioManager {
  static SOUNDS = AVAILABLE_SOUNDS

  _initialized = false
  // NOTE(tec27): If we end up with a lot of different sounds (or potentially larger sounds) we
  // probably don't want to keep all these in memory forever :)
  _loadedSounds = []
  _context = new AudioContext()
  _nodes = {
    destination: this._context.destination,
    masterGain: this._context.createGain(),
  }

  constructor() {
    this._nodes.masterGain.connect(this._nodes.destination)
  }

  async initialize() {
    const appPath = remote.app.getAppPath()
    const promises = Object.keys(SOUND_FILES).map(async sound => {
      const filename = path.join(appPath, SOUND_PATH, SOUND_FILES[sound])
      const buf = await readFileAsync(filename)
      this._loadedSounds[sound] = await this._context.decodeAudioData(buf.buffer)
    })

    await Promise.all(promises)
    this._initialized = true
  }

  // soundId is a value from AudioManager.SOUNDS
  playSound(soundId) {
    const buffer = this._loadedSounds[soundId]
    if (!buffer) {
      throw new Error('Invalid sound ID: ' + soundId)
    }

    const source = this._context.createBufferSource()

    if (!this._initialized) {
      return source
    }

    source.buffer = buffer
    source.connect(this._nodes.masterGain)
    source.start()

    return source
  }
}
