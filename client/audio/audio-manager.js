import { remote } from 'electron'
import fs from 'fs'
import path from 'path'
import thenify from 'thenify'

const readFileAsync = thenify(fs.readFile)

const SOUND_PATH = path.join('assets', 'sounds')

const AVAILABLE_SOUNDS = {
  JOIN_ALERT: 0,
  COUNTDOWN: 1,
  ATMOSPHERE: 2,
}
const s = AVAILABLE_SOUNDS
const SOUND_FILES = {
  [s.JOIN_ALERT]: 'join-alert.opus',
  [s.COUNTDOWN]: 'countdown.opus',
  [s.ATMOSPHERE]: 'atmosphere.opus',
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

  _getBufferSource(soundId) {
    if (!SOUND_FILES[soundId]) {
      throw new Error('Invalid sound ID: ' + soundId)
    }

    const source = this._context.createBufferSource()
    if (!this._initialized) {
      return source
    }

    source.buffer = this._loadedSounds[soundId]
    return source
  }

  get currentTime() {
    return this._context.currentTime
  }

  // soundId is a value from AudioManager.SOUNDS
  // Returns the AudioBufferSourceNode
  playSound(soundId) {
    const source = this._getBufferSource(soundId)
    source.connect(this._nodes.masterGain)
    source.start()
    return source
  }

  // soundId is a value from AudioManager.SOUNDS
  // Returns { source: AudioBufferSourceNode, gainNode: GainNode}
  playFadeableSound(soundId) {
    const source = this._getBufferSource(soundId)
    const gainNode = this._context.createGain()

    source.connect(gainNode)
    gainNode.connect(this._nodes.masterGain)
    source.start()
    return { source, gainNode }
  }
}
