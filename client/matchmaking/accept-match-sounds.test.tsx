import { act, render } from '@testing-library/react'
import { createStore as createJotaiStore, Provider as JotaiProvider } from 'jotai'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MatchmakingType } from '../../common/matchmaking'
import { asMockedFunction } from '../../common/testing/mocks'
import { audioManager, AvailableSound } from '../audio/audio-manager'
import { playRandomTickSound } from '../audio/tick-sounds'
import { AcceptMatchCountdownSounds } from './accept-match-sounds'
import { FoundMatch, foundMatchAtom } from './matchmaking-atoms'

const { ipcSend } = vi.hoisted(() => ({ ipcSend: vi.fn() }))

vi.mock('../audio/audio-manager', () => ({
  audioManager: { playFadeableSound: vi.fn() },
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
const playRandomTickSoundMock = asMockedFunction(playRandomTickSound)

const ACCEPT_TIME_MS = 30000

function makeMatch(): FoundMatch {
  return {
    matchmakingType: MatchmakingType.Match1v1,
    numPlayers: 2,
    acceptStart: performance.now(),
    acceptTimeTotalMillis: ACCEPT_TIME_MS,
    acceptedPlayers: 0,
    hasAccepted: false,
  }
}

let jotaiStore: ReturnType<typeof createJotaiStore>

function renderSounds() {
  return render(
    <JotaiProvider store={jotaiStore}>
      <AcceptMatchCountdownSounds />
    </JotaiProvider>,
  )
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

describe('client/matchmaking/accept-match-sounds', () => {
  let fadeOut: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // `performance.now()` is what the countdown reads, and it isn't faked by default.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    })
    jotaiStore = createJotaiStore()
    fadeOut = vi.fn()
    playFadeableSoundMock.mockReset().mockReturnValue({ fadeOut } as any)
    playRandomTickSoundMock.mockReset().mockReturnValue({ fadeOut } as any)
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
  })

  test('plays nothing until ten seconds remain', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(11)

    expect(playRandomTickSoundMock).not.toHaveBeenCalled()
    expect(ipcSend).not.toHaveBeenCalled()
  })

  test('ticks once per second from ten seconds out, asking for attention each time', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(10)
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(1)
    expect(ipcSend).toHaveBeenCalledWith('userAttentionRequired')

    advanceBy(1000)
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(2)
    // The previous second's tick is faded out as the next one starts.
    expect(fadeOut).toHaveBeenCalledTimes(1)
  })

  test('hands over to the single countdown sound for the last seconds, without retriggering it', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(4)
    expect(playFadeableSoundMock).toHaveBeenCalledTimes(1)
    expect(playFadeableSoundMock).toHaveBeenCalledWith(AvailableSound.Countdown)

    advanceBy(3000)
    expect(playFadeableSoundMock).toHaveBeenCalledTimes(1)
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(6)
  })

  test('keeps playing while the dialog is dismissed, since it does not depend on the dialog', () => {
    // No dialog is rendered here at all; the sounds only follow the found-match state.
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(8)

    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(3)
  })

  test('goes quiet and fades the playing sound once this client has accepted', () => {
    const match = makeMatch()
    jotaiStore.set(foundMatchAtom, match)
    renderSounds()

    advanceTo(9)
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(2)

    act(() => {
      jotaiStore.set(foundMatchAtom, { ...match, hasAccepted: true })
    })
    expect(fadeOut).toHaveBeenCalledTimes(2)

    advanceBy(5000)
    expect(playRandomTickSoundMock).toHaveBeenCalledTimes(2)
    expect(playFadeableSoundMock).not.toHaveBeenCalled()
  })

  test('fades the playing sound out when the match goes away', () => {
    jotaiStore.set(foundMatchAtom, makeMatch())
    renderSounds()

    advanceTo(10)
    expect(fadeOut).not.toHaveBeenCalled()

    act(() => {
      jotaiStore.set(foundMatchAtom, undefined)
    })

    expect(fadeOut).toHaveBeenCalledTimes(1)
  })
})
