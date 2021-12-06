import { urlPath } from '../../common/urls'
import { fetchRaw } from '../network/fetch'

export enum AvailableSound {
  Atmosphere = 'atmosphere.opus',
  Countdown = 'countdown.opus',
  EnteredQueue = 'entered-queue.opus',
  JoinAlert = 'join-alert.opus',
  MatchFound = 'match-found.opus',
  PartyInvite = 'party-invite.opus',
  PartyQueue = 'party-queue.opus',
}

const ALL_SOUNDS: ReadonlyArray<AvailableSound> = Object.values(AvailableSound)

// TODO(tec27): There's not terribly much electron-specific about playing audio, we just need
// an alternate way to load the sounds. We also probably don't want to block on stuff like message
// notification sounds for the web version?

export class AudioManager {
  private initialized = false
  // NOTE(tec27): If we end up with a lot of different sounds (or potentially larger sounds) we
  // probably don't want to keep all these in memory forever :)
  private loadedSounds = new Map<AvailableSound, AudioBuffer>()
  private context = new AudioContext()
  private nodes = {
    destination: this.context.destination,
    masterGain: this.context.createGain(),
  }

  constructor() {
    this.nodes.masterGain.connect(this.nodes.destination)
  }

  async initialize() {
    if (!IS_ELECTRON) {
      return
    }

    // TODO(tec27): Make a way to avoid loading all of these upfront, and instead do it only
    // when we need them (maybe with a way to preload when we think we'll need something?)
    const promises = ALL_SOUNDS.map(async sound => {
      const response = await fetchRaw(location.origin + urlPath`/assets/sounds/${sound}`)
      this.loadedSounds.set(sound, await this.context.decodeAudioData(await response.arrayBuffer()))
    })

    await Promise.all(promises)
    this.initialized = true
  }

  private getBufferSource(soundId: AvailableSound) {
    const source = this.context.createBufferSource()
    if (!this.initialized) {
      return source
    }

    source.buffer = this.loadedSounds.get(soundId)!
    return source
  }

  get currentTime() {
    return this.context.currentTime
  }

  get masterVolume() {
    return this.nodes.masterGain.gain.value
  }

  /**
   * Volume should be a value between 0 and 100, which represents the percentage that the master
   * volume will be set to.
   */
  setMasterVolume(volume: number) {
    if (!IS_ELECTRON) {
      return
    }

    if (Number.isNaN(volume) || volume < 0 || volume > 100) {
      throw new Error('Invalid volume value: ' + volume)
    }

    this.nodes.masterGain.gain.value = (1.5 * volume) / 100
  }

  /**
   * Plays the specified sound.
   */
  playSound(soundId: AvailableSound): AudioBufferSourceNode | undefined {
    if (!IS_ELECTRON) {
      return undefined
    }

    const source = this.getBufferSource(soundId)
    source.connect(this.nodes.masterGain)
    source.start()
    return source
  }

  /**
   * Plays a sound that can be faded in/out using a GainNode.
   */
  playFadeableSound(soundId: AvailableSound):
    | {
        source: AudioBufferSourceNode
        gainNode: GainNode
      }
    | undefined {
    if (!IS_ELECTRON) {
      return undefined
    }

    const source = this.getBufferSource(soundId)
    const gainNode = this.context.createGain()

    source.connect(gainNode)
    gainNode.connect(this.nodes.masterGain)
    source.start()
    return { source, gainNode }
  }
}

const instance = new AudioManager()
export default instance
