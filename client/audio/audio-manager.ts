import { urlPath } from '../../common/urls'
import logger from '../logging/logger'
import { fetchRaw } from '../network/fetch'

export enum AvailableSound {
  Atmosphere = 'atmosphere.opus',
  Click = 'click.opus',
  Countdown = 'countdown.opus',
  DraftStart = 'draft-start.opus',
  EnteredQueue = 'entered-queue.opus',
  JoinAlert = 'join-alert.opus',
  LockIn = 'lock-in.opus',
  MatchFound = 'match-found.opus',
  MessageAlert = 'message-alert.opus',
  // PartyInvite = 'party-invite.opus',
  // PartyQueue = 'party-queue.opus',
  PlayButton = 'play-button.opus',
  PointReveal = 'point-reveal.opus',
  RankUp = 'rank-up.opus',
  ScoreCount = 'score-count.opus',

  Tick1 = 'tick-01.opus',
  Tick2 = 'tick-02.opus',
  Tick3 = 'tick-03.opus',
  Tick4 = 'tick-04.opus',
  Tick5 = 'tick-05.opus',
  Tick6 = 'tick-06.opus',
  Tick7 = 'tick-07.opus',
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

  // Assigned by createContext(), which the constructor calls immediately and which
  // recreateContext() calls again to swap in a fresh context after the renderer kills one.
  private context!: AudioContext
  private nodes!: {
    destination: AudioDestinationNode
    masterGain: GainNode
  }
  // Lets a context being replaced have its listeners detached before it's closed, so the close()
  // doesn't itself trigger a spurious statechange/error through a stale handler.
  private listenerAbort!: AbortController

  // Backoff state for context recreation. The counter only resets to 0 once the context has
  // stayed 'running' for 30s straight, so a device that keeps flapping keeps escalating the
  // delay instead of resetting on every brief recovery.
  private recreateAttempts = 0
  private healthyResetTimer: ReturnType<typeof setTimeout> | undefined
  private recreateTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    this.createContext()
  }

  /**
   * Creates the AudioContext and master gain node, and wires up the diagnostics/recovery
   * listeners. Called once from the constructor, and again from recreateContext() to replace a
   * context the renderer has killed.
   */
  private createContext() {
    const context = new AudioContext()
    const masterGain = context.createGain()
    masterGain.connect(context.destination)

    this.context = context
    this.nodes = {
      destination: context.destination,
      masterGain,
    }

    if (!IS_ELECTRON) {
      // The web build never plays sounds and its context starts (and stays) suspended under
      // autoplay policy, so watching it here would just be log noise.
      return
    }

    this.listenerAbort = new AbortController()
    const { signal } = this.listenerAbort

    context.addEventListener(
      'statechange',
      () => {
        logger.verbose(`AudioContext state changed to: ${context.state}`)
        clearTimeout(this.healthyResetTimer)

        if (context.state === 'running') {
          this.healthyResetTimer = setTimeout(() => {
            this.recreateAttempts = 0
          }, 30_000)
        } else if (context.state === 'suspended') {
          // Nothing in this class calls suspend() itself, so landing here means the OS/renderer
          // suspended the context out from under us (e.g. an audio device change).
          logger.warning('AudioContext was unexpectedly suspended, attempting to resume')
          context.resume().catch(err => {
            logger.error(`Failed to resume suspended AudioContext: ${err}`)
          })
        } else if (context.state === 'closed') {
          // Nothing in this class closes a context that still has listeners attached (they're
          // detached before our own close() during recreation), so landing here means the
          // renderer/device killed the context without firing an error event.
          logger.warning('AudioContext was closed unexpectedly')
          this.scheduleRecreate()
        }
      },
      { signal },
    )

    context.addEventListener(
      'error',
      event => {
        const message = event instanceof ErrorEvent ? event.message : undefined
        logger.error(`AudioContext error (state: ${context.state})${message ? `: ${message}` : ''}`)
        clearTimeout(this.healthyResetTimer)

        // Fire-and-forget diagnostics: helps correlate context errors with device changes in
        // prod logs (output devices can be swapped/removed without an explicit device-change
        // signal reaching this class).
        navigator.mediaDevices
          .enumerateDevices()
          .then(devices => {
            const outputs = devices.filter(d => d.kind === 'audiooutput')
            logger.verbose(
              `Audio output devices (${outputs.length}): [${outputs.map(d => d.label).join(', ')}]`,
            )
          })
          .catch(err => {
            logger.error(`Failed to enumerate audio devices: ${err}`)
          })

        this.scheduleRecreate()
      },
      { signal },
    )
  }

  /**
   * Schedules a context recreation with exponential backoff (capped at 30s). No-op if a
   * recreation is already pending.
   */
  private scheduleRecreate() {
    if (this.recreateTimer !== undefined) {
      return
    }

    const delay = Math.min(1000 * 2 ** this.recreateAttempts, 30_000)
    this.recreateAttempts++
    this.recreateTimer = setTimeout(() => {
      this.recreateTimer = undefined
      this.recreateContext()
    }, delay)
  }

  /**
   * Swaps in a fresh AudioContext after the current one has been killed by the renderer/device.
   * Decoded AudioBuffers aren't tied to a particular context, so `loadedSounds` keeps working
   * against the new context unchanged; anything mid-playback on the old context is simply lost.
   */
  private recreateContext() {
    const previousGain = this.nodes.masterGain.gain.value
    const oldContext = this.context

    this.listenerAbort.abort()
    oldContext.close().catch(() => {
      // May already be closed by the renderer that killed it.
    })

    this.createContext()
    this.nodes.masterGain.gain.value = previousGain

    logger.warning(
      `AudioContext recreated after an audio device/renderer error (new state: ${this.context.state})`,
    )
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
   * @params soundId the id of the sound to play
   * @params loop whether the sound should loop or not (defaults to false)
   * @params when the time at which the sound should start playing, in seconds, relative to the
   *   current time (defaults to 0)
   */
  playSound(
    soundId: AvailableSound,
    options?: Partial<{
      loop: boolean
      when: number
    }>,
  ): AudioBufferSourceNode | undefined {
    if (!IS_ELECTRON) {
      return undefined
    }

    const source = this.getBufferSource(soundId)
    if (options?.loop) {
      source.loop = true
    }
    source.connect(this.nodes.masterGain)
    source.start(options?.when ? this.context.currentTime + options.when : 0)
    return source
  }

  /**
   * Plays a sound that can be faded in/out using a GainNode.
   */
  playFadeableSound(
    soundId: AvailableSound,
    options?: Partial<{
      loop: boolean
      when: number
    }>,
  ): FadeableSound | undefined {
    if (!IS_ELECTRON) {
      return undefined
    }

    const source = this.getBufferSource(soundId)
    if (options?.loop) {
      source.loop = true
    }
    const gainNode = this.context.createGain()

    source.connect(gainNode)
    gainNode.connect(this.nodes.masterGain)
    source.start(options?.when ? this.context.currentTime + options.when : 0)
    return new FadeableSound(source, gainNode)
  }
}

export class FadeableSound {
  constructor(
    readonly source: AudioBufferSourceNode,
    readonly gainNode: GainNode,
  ) {}

  /** Fade the sound out over the specified duration (in seconds). */
  fadeOut(duration = 0.3) {
    this.gainNode.gain.exponentialRampToValueAtTime(0.001, audioManager.currentTime + duration)
    this.source.stop(audioManager.currentTime + duration + 0.1)
  }

  get loop(): boolean {
    return this.source.loop
  }

  set loop(value: boolean) {
    this.source.loop = value
  }
}

export const audioManager = new AudioManager()
