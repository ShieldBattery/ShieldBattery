import { useAtomValue } from 'jotai'
import { useEffect, useEffectEvent } from 'react'
import { TypedIpcRenderer } from '../../common/ipc'
import { audioManager, AvailableSound, FadeableSound } from '../audio/audio-manager'
import { playRandomTickSound } from '../audio/tick-sounds'
import { useAppSelector } from '../redux-hooks'
import { foundMatchAtom, hasAcceptedAtom } from './matchmaking-atoms'
import { useAcceptCountdown } from './use-accept-countdown'

const ipcRenderer = new TypedIpcRenderer()

/** How often the countdown is sampled to time the attention requests. */
const ATTENTION_TICK_MS = 100
/** Seconds left at which the per-second ticks start. */
const TICK_START_SECONDS = 10
/**
 * Seconds left at which the single countdown sound takes over from the per-second ticks. It covers
 * every remaining second on its own.
 */
const COUNTDOWN_SOUND_SECONDS = 4

/**
 * Plays the end-of-accept-window sounds for a found match this client hasn't readied up for:
 * per-second ticks from ten seconds out, then a single countdown sound over the last few. Each
 * second also asks the OS for attention (if the user allows taskbar flashing), since the window may
 * be behind something else.
 *
 * The sounds are all scheduled on the audio clock as soon as the match is found, rather than
 * started from timers as each second arrives: a hidden or fully covered window can have its timers
 * throttled to as little as one wake-up a minute, which would skip them, and those are exactly the
 * windows the sounds are for. The audio clock is held running for the same reason, since in such a
 * window it would otherwise fall behind real time while nothing is playing.
 *
 * Lives outside the accept dialog because the dialog can be dismissed while the match is still
 * waiting on this client, and the whole point of the sounds is to reach someone who isn't looking
 * at it. Mount it once, anywhere that stays mounted while matchmaking.
 */
export function AcceptMatchCountdownSounds() {
  const foundMatch = useAtomValue(foundMatchAtom)
  const hasAccepted = useAtomValue(hasAcceptedAtom)
  const { secondsLeft } = useAcceptCountdown(foundMatch, ATTENTION_TICK_MS)
  const flashTaskbar = useAppSelector(s => s.settings.account.flashTaskbar)
  // Read through an effect event so that changing the setting mid-countdown doesn't rerun the
  // effect and repeat the current second's request.
  const requestAttention = useEffectEvent(() => {
    if (flashTaskbar) {
      ipcRenderer.send('userAttentionRequired')
    }
  })

  // When the accept window ends, in `performance.now()` time, while there's something to warn
  // about.
  const deadline =
    foundMatch && !hasAccepted
      ? foundMatch.acceptStart + foundMatch.acceptTimeTotalMillis
      : undefined

  useEffect(() => {
    if (deadline === undefined) {
      return () => {}
    }

    const releaseClock = audioManager.keepClockRunning()
    const now = window.performance.now()
    // Seconds from now until `secondsLeft` seconds remain, or 0 if that's already passed.
    const delayUntil = (secondsLeft: number) =>
      Math.max(0, (deadline - secondsLeft * 1000 - now) / 1000)

    const sounds: Array<FadeableSound | undefined> = []
    // A second that's already over is skipped, but one that's underway (say, for a match picked up
    // partway through its window) still gets its sound, right away.
    for (let second = TICK_START_SECONDS; second > COUNTDOWN_SOUND_SECONDS; second--) {
      if (now < deadline - (second - 1) * 1000) {
        sounds.push(playRandomTickSound({ when: delayUntil(second) }))
      }
    }
    if (now < deadline) {
      sounds.push(
        audioManager.playFadeableSound(AvailableSound.Countdown, {
          when: delayUntil(COUNTDOWN_SOUND_SECONDS),
        }),
      )
    }

    // Once the match is accepted or gone, a sound still playing is faded out rather than cut, and
    // the ones that haven't started are canceled.
    return () => {
      for (const sound of sounds) {
        sound?.fadeOut()
      }
      releaseClock()
    }
  }, [deadline])

  // `undefined` while there's nothing to warn about, otherwise the seconds left floored at the
  // countdown sound's start, so the seconds it covers ask for attention only once.
  const attentionTimeLeft =
    deadline !== undefined ? Math.max(COUNTDOWN_SOUND_SECONDS, secondsLeft) : undefined

  useEffect(() => {
    if (attentionTimeLeft !== undefined && attentionTimeLeft <= TICK_START_SECONDS) {
      requestAttention()
    }
  }, [attentionTimeLeft])

  return null
}
