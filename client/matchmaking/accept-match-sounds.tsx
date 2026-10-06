import { useAtomValue } from 'jotai'
import { useEffect, useEffectEvent } from 'react'
import { TypedIpcRenderer } from '../../common/ipc'
import { audioManager, AvailableSound, FadeableSound } from '../audio/audio-manager'
import { playRandomTickSound } from '../audio/tick-sounds'
import { useAppSelector } from '../redux-hooks'
import { foundMatchAtom, hasAcceptedAtom } from './matchmaking-atoms'
import { useAcceptCountdown } from './use-accept-countdown'

const ipcRenderer = new TypedIpcRenderer()

/**
 * How often the countdown is sampled. Fast enough that each tick sound lands close to its second
 * boundary.
 */
const SOUND_TICK_MS = 100
/** Seconds left at which the per-second ticks start. */
const TICK_START_SECONDS = 10
/**
 * Seconds left at which the single countdown sound takes over from the per-second ticks. It covers
 * every remaining second on its own, so the countdown value stops changing once it's reached.
 */
const COUNTDOWN_SOUND_SECONDS = 4

/**
 * Plays the end-of-accept-window sounds for a found match this client hasn't readied up for:
 * per-second ticks from ten seconds out, then a single countdown sound over the last few. Each
 * also asks the OS for attention (if the user allows taskbar flashing), since the window may be
 * behind something else.
 *
 * Lives outside the accept dialog because the dialog can be dismissed while the match is still
 * waiting on this client, and the whole point of the sounds is to reach someone who isn't looking
 * at it. Mount it once, anywhere that stays mounted while matchmaking.
 */
export function AcceptMatchCountdownSounds() {
  const foundMatch = useAtomValue(foundMatchAtom)
  const hasAccepted = useAtomValue(hasAcceptedAtom)
  const { secondsLeft } = useAcceptCountdown(foundMatch, SOUND_TICK_MS)
  const flashTaskbar = useAppSelector(s => s.settings.account.flashTaskbar)
  // Read through an effect event so that changing the setting mid-countdown doesn't rerun the
  // effect and replay the current second's sound.
  const requestAttention = useEffectEvent(() => {
    if (flashTaskbar) {
      ipcRenderer.send('userAttentionRequired')
    }
  })

  // The value the sounds key off: `undefined` while there's nothing to warn about, otherwise the
  // seconds left floored at the countdown sound's start, so the seconds it covers don't retrigger
  // it.
  const soundTimeLeft =
    foundMatch && !hasAccepted ? Math.max(COUNTDOWN_SOUND_SECONDS, secondsLeft) : undefined

  useEffect(() => {
    if (soundTimeLeft === undefined) {
      return () => {}
    }

    let sound: FadeableSound | undefined
    if (soundTimeLeft === COUNTDOWN_SOUND_SECONDS) {
      sound = audioManager.playFadeableSound(AvailableSound.Countdown)
      requestAttention()
    } else if (soundTimeLeft <= TICK_START_SECONDS) {
      sound = playRandomTickSound()
      requestAttention()
    }

    // A sound still playing when its second ends, or when the match is accepted or gone, is faded
    // out rather than cut.
    return () => {
      sound?.fadeOut()
    }
  }, [soundTimeLeft])

  return null
}
