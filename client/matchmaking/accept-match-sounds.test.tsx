import { act, render } from '@testing-library/react'
import { createStore as createJotaiStore, Provider as JotaiProvider } from 'jotai'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import { DEFAULT_ACCOUNT_SETTINGS } from '../../common/settings/account-settings'
import { asMockedFunction } from '../../common/testing/mocks'
import { audioManager, AvailableSound } from '../audio/audio-manager'
import { playRandomTickSound } from '../audio/tick-sounds'
import createReduxStore from '../create-store'
import { AcceptMatchCountdownSounds } from './accept-match-sounds'
import { acceptedPlayersAtom, FoundMatch, foundMatchAtom } from './matchmaking-atoms'

const { ipcSend } = vi.hoisted(() => ({ ipcSend: vi.fn() }))

vi.mock('../audio/audio-manager', () => ({
  audioManager: { playFadeableSound: vi.fn(), keepClockRunning: vi.fn() },
  AvailableSound: { Countdown: 'countdown' },
}))

vi.mock('../audio/tick-sounds', () => ({
  playRandomTickSound: vi.fn(),
}))

vi.mock('../../common/ipc', () => ({
  TypedIpcRenderer: class {
    send = ipcSend
  },
}))

const playFadeableSoundMock = asMockedFunction(audioManager.playFadeableSound)
const keepClockRunningMock = asMockedFunction(audioManager.keepClockRunning)
const playRandomTickSoundMock = asMockedFunction(playRandomTickSound)

const ACCEPT_TIME_MS = 30000

/** A match whose accept window started `elapsedMillis` ago. */
function makeMatch(elapsedMillis = 0): FoundMatch {
  return {
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers: 2,
    acceptStart: performance.now() - elapsedMillis,
    acceptTimeTotalMillis: ACCEPT_TIME_MS,
    acceptedPlayers: 0,
    hasAccepted: false,
  }
}

let jotaiStore: ReturnType<typeof createJotaiStore>
let reduxStore: ReturnType<typeof createReduxStore>

function renderSounds() {
  return render(
    <ReduxProvider store={reduxStore}>
      <JotaiProvider store={jotaiStore}>
        <AcceptMatchCountdownSounds />
      </JotaiProvider>
    </ReduxProvider>,
  )
}

function setFlashTaskbar(flashTaskbar: boolean) {
  act(() => {
    reduxStore.dispatch({
      type: '@settings/updateAccountSettings',
      payload: { ...DEFAULT_ACCOUNT_SETTINGS, flashTaskbar },
    })
  })
}

/**
 * Advances the clock by `millis`, one second per render. Timer callbacks that fire inside a single
 * `act` are batched into one render, which would skip the seconds in between; in the app each
 * tick renders before the next fires.
 */
function advanceBy(millis: number) {
  for (let remaining = millis; remaining > 0; remaining -= 1000) {
    act(() => {
      vi.advanceTimersByTime(Math.min(1000, remaining))
    })
  }
}

/** Advances the clock to `secondsLeft` seconds before the accept window of a fresh match ends. */
function advanceTo(secondsLeft: number) {
  advanceBy(ACCEPT_TIME_MS - secondsLeft * 1000 + 50)
}

/** The `when` (seconds from scheduling) each tick was scheduled for, in call order. */
function tickDelays() {
  return playRandomTickSoundMock.mock.calls.map(([options]) => options?.when)
}

function countdownDelays() {
  return playFadeableSoundMock.mock.calls.map(([sound, options]) => {
    expect(sound).toBe(AvailableSound.Countdown)
    return options?.when
  })
}

describe('client/matchmaking/accept-match-sounds', () => {
  let fadeOut: ReturnType<typeof vi.fn>
  let releaseClock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // `performance.now()` is what the countdown reads, and it isn't faked by default.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    })
    jotaiStore = createJotaiStore()
    reduxStore = createReduxStore()
    fadeOut = vi.fn()
    playFadeableSoundMock.mockReset().mockReturnValue({ fadeOut } as any)
    playRandomTickSoundMock.mockReset().mockReturnValue({ fadeOut } as any)
    releaseClock = vi.fn()
    keepClockRunningMock.mockReset().mockReturnValue(releaseClock as any)
    ipcSend.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('is silent with no match found', () => {
    renderSounds()

    act(() => {
      vi.advanceTimersByTime(ACCEPT_TIME_MS)
    })

    expect(playRandomTickSoundMock).not.toHaveBeenCalled()
    expect(playFadeableSoundMock).not.toHaveBeenCalled()
    expect(keepClockRunningMock).not.toHaveBeenCalled()
  })

  test('schedules every tick and the countdown sound as soon as the match is found', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    // Nothing has to wait on a timer, so throttled timers in a hidden window can't skip them.
    expect(tickDelays()).toEqual([20, 21, 22, 23, 24, 25])
    expect(countdownDelays()).toEqual([26])
  })

  test('holds the audio clock running from the match being found until it goes away', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    expect(keepClockRunningMock).toHaveBeenCalledTimes(1)
    advanceTo(1)
    expect(releaseClock).not.toHaveBeenCalled()

    act(() => {
      jotaiStore.set(foundMatchAtom, undefined)
    })
    expect(releaseClock).toHaveBeenCalledTimes(1)
  })

  test('releases the audio clock once this client has accepted', () => {
    const match = makeMatch()
    jotaiStore.set(foundMatchAtom, match)
    renderSounds()

    act(() => {
      jotaiStore.set(foundMatchAtom, { ...match, hasAccepted: true })
    })
    expect(releaseClock).toHaveBeenCalledTimes(1)
    expect(keepClockRunningMock).toHaveBeenCalledTimes(1)
  })

  test('does not reschedule as the countdown runs', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(1)
    act(() => {
      jotaiStore.set(acceptedPlayersAtom, 1)
    })

    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(6)
    expect(playFadeableSoundMock).toHaveBeenCalledTimes(1)
    expect(fadeOut).not.toHaveBeenCalled()
  })

  test('for a match picked up partway, skips finished seconds and plays the current one now', () => {
    jotaiStore.set(foundMatchAtom, makeMatch(22_500))
    renderSounds()

    expect(tickDelays()).toEqual([0, 0.5, 1.5, 2.5])
    expect(countdownDelays()).toEqual([3.5])
  })

  test('for a match picked up during the countdown, plays only the countdown sound, right away', () => {
    jotaiStore.set(foundMatchAtom, makeMatch(28_000))
    renderSounds()

    expect(playRandomTickSoundMock).not.toHaveBeenCalled()
    expect(countdownDelays()).toEqual([0])
  })

  test('plays nothing for a match whose window has already run out', () => {
    jotaiStore.set(foundMatchAtom, makeMatch(ACCEPT_TIME_MS))
    renderSounds()

    expect(playRandomTickSoundMock).not.toHaveBeenCalled()
    expect(playFadeableSoundMock).not.toHaveBeenCalled()
  })

  test('schedules nothing for a match this client has already accepted', () => {
    jotaiStore.set(foundMatchAtom, { ...makeMatch(), hasAccepted: true })
    renderSounds()

    expect(playRandomTickSoundMock).not.toHaveBeenCalled()
    expect(playFadeableSoundMock).not.toHaveBeenCalled()
  })

  test('fades or cancels every scheduled sound once this client has accepted', () => {
    const match = makeMatch()
    jotaiStore.set(foundMatchAtom, match)
    renderSounds()

    advanceTo(9)
    act(() => {
      jotaiStore.set(foundMatchAtom, { ...match, hasAccepted: true })
    })
    expect(fadeOut).toHaveBeenCalledTimes(7)

    advanceBy(9000)
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(6)
    expect(playFadeableSoundMock).toHaveBeenCalledTimes(1)
  })

  test('fades or cancels every scheduled sound when the match goes away', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    act(() => {
      jotaiStore.set(foundMatchAtom, undefined)
    })

    expect(fadeOut).toHaveBeenCalledTimes(7)
  })

  test('asks for attention once per ticking second and once for the countdown', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(11)
    expect(ipcSend).not.toHaveBeenCalled()

    advanceBy(1000)
    expect(ipcSend).toHaveBeenCalledTimes(1)
    expect(ipcSend).toHaveBeenCalledWith('userAttentionRequired')

    advanceBy(10_000)
    expect(ipcSend).toHaveBeenCalledTimes(7)
  })

  test('does not ask for attention when taskbar flashing is off', () => {
    setFlashTaskbar(false)
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(1)
    expect(ipcSend).not.toHaveBeenCalled()
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(6)
    expect(playFadeableSoundMock).toHaveBeenCalledTimes(1)
  })

  test('turning taskbar flashing off mid-countdown repeats neither a request nor a sound', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(10)
    expect(ipcSend).toHaveBeenCalledTimes(1)

    setFlashTaskbar(false)
    advanceBy(1000)
    expect(ipcSend).toHaveBeenCalledTimes(1)
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(6)
  })
})
