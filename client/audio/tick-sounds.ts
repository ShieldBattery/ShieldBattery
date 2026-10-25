import { audioManager, AvailableSound } from './audio-manager'

const TICK_SOUNDS: ReadonlyArray<AvailableSound> = [
  AvailableSound.Tick1,
  AvailableSound.Tick2,
  AvailableSound.Tick3,
  AvailableSound.Tick4,
  AvailableSound.Tick5,
  AvailableSound.Tick6,
  AvailableSound.Tick7,
]

/**
 * Plays one of the tick sounds at random, optionally `when` seconds from now (see
 * `AudioManager.playFadeableSound`).
 */
export function playRandomTickSound(options?: { when?: number }) {
  const index = Math.floor(Math.random() * TICK_SOUNDS.length)
  return audioManager.playFadeableSound(TICK_SOUNDS[index], options)
}
