import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { StrictMode } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { urlForLobby } from '../../common/lobbies/lobby-url'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { makeSbMapId } from '../../common/maps'
import { encodePrettyId } from '../../common/pretty-id'
import { SbUser } from '../../common/users/sb-user'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { LobbyLandingContent } from './lobby-landing'
import { LobbySummaryLoadState } from './lobby-summary'

const HOST: SbUser = { id: makeSbUserId(1), name: 'HostUser', created: 0 }
const LOBBY_ID = makeSbLobbyId(encodePrettyId('5eed0000-0000-0000-0000-000000000042'))
const OTHER_LOBBY_ID = makeSbLobbyId(encodePrettyId('5eed0000-0000-0000-0000-000000000043'))

function makeLobbySummary(id = LOBBY_ID, name = 'Fastest Game Ever'): LobbySummaryResponse {
  return {
    summary: {
      id,
      name,
      map: {
        id: makeSbMapId('map-1'),
        name: 'Fighting Spirit',
        mapData: { width: 128, height: 128 },
      },
      gameType: GameType.Melee,
      gameSubType: 0,
      host: { id: HOST.id },
      playerSlots: { taken: 1, total: 4, open: 3 },
      useLegacyLimits: false,
      starcraftCompatibleReplays: true,
      lifecycle: 'gathering',
    },
    host: HOST,
    joinCode: 'BQ4XM9',
  }
}

function loadedState(data = makeLobbySummary()): LobbySummaryLoadState {
  return { status: 'loaded', data }
}

function renderLanding(state: LobbySummaryLoadState | undefined, strict = false) {
  const page = <LobbyLandingContent state={state} />
  return render(strict ? <StrictMode>{page}</StrictMode> : page)
}

function expectedDeepLink(data = makeLobbySummary()) {
  return `shieldbattery:/${urlForLobby(data.summary.id, data.summary.name)}`
}

let touchDevice = false

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  touchDevice = false
  Object.defineProperty(window, 'SB_DEEP_LINK_SCHEME', {
    configurable: true,
    value: 'shieldbattery',
  })
  vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  vi.spyOn(window, 'matchMedia').mockImplementation(
    query =>
      ({
        matches: touchDevice && query === '(hover: none) and (pointer: coarse)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.SB_DEEP_LINK_SCHEME
})

describe('LobbyLandingContent automatic app launch', () => {
  test('automatically invokes the deployment scheme for a loaded lobby', () => {
    const data = makeLobbySummary()

    renderLanding(loadedState(data))

    expect(window.location.assign).toHaveBeenCalledExactlyOnceWith(expectedDeepLink(data))
  })

  test('attempts once through Strict Mode effects and re-renders', () => {
    const data = makeLobbySummary()
    const { rerender } = renderLanding(loadedState(data), true)

    rerender(
      <StrictMode>
        <LobbyLandingContent state={loadedState({ ...data })} />
      </StrictMode>,
    )

    expect(window.location.assign).toHaveBeenCalledOnce()
  })

  test('restores launch detection after Strict Mode cleanup without invoking twice', () => {
    vi.useFakeTimers()

    renderLanding(loadedState(), true)

    expect(window.location.assign).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    expect(screen.getByText("Couldn't open ShieldBattery automatically.")).toBeTruthy()
    expect(window.location.assign).toHaveBeenCalledOnce()
  })

  test('does not retry when lobby metadata changes its URL slug', () => {
    const data = makeLobbySummary()
    const { rerender } = renderLanding(loadedState(data))

    rerender(
      <LobbyLandingContent
        state={loadedState(makeLobbySummary(data.summary.id, 'A different lobby name'))}
      />,
    )

    expect(window.location.assign).toHaveBeenCalledExactlyOnceWith(expectedDeepLink(data))
  })

  test('attempts again after navigating to a different lobby', () => {
    const firstLobby = makeLobbySummary()
    const secondLobby = makeLobbySummary(OTHER_LOBBY_ID, 'Another Lobby')
    const { rerender } = renderLanding(loadedState(firstLobby))

    rerender(<LobbyLandingContent state={loadedState(secondLobby)} />)

    expect(window.location.assign).toHaveBeenCalledTimes(2)
    expect(window.location.assign).toHaveBeenNthCalledWith(1, expectedDeepLink(firstLobby))
    expect(window.location.assign).toHaveBeenNthCalledWith(2, expectedDeepLink(secondLobby))
  })

  test('does not invoke the desktop protocol on touch devices', () => {
    touchDevice = true

    renderLanding(loadedState())

    expect(window.location.assign).not.toHaveBeenCalled()
  })

  test('does not move browser focus during an automatic launch', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')

    renderLanding(loadedState())

    expect(focus).not.toHaveBeenCalled()
  })

  test('does not invoke the protocol when no deployment scheme is configured', () => {
    delete window.SB_DEEP_LINK_SCHEME

    renderLanding(loadedState())

    expect(window.location.assign).not.toHaveBeenCalled()
  })

  test.each([
    ['loading', undefined],
    ['expired', { status: 'notFound' }],
    ['error', { status: 'error' }],
  ] as const)('does not launch while the lobby is %s', (_name, state) => {
    renderLanding(state)

    expect(window.location.assign).not.toHaveBeenCalled()
  })

  test('does not auto-launch when the harness forces a launch state', () => {
    render(<LobbyLandingContent state={loadedState()} forceLaunchState='idle' />)

    expect(window.location.assign).not.toHaveBeenCalled()
  })

  test('keeps manual retry available after an automatic attempt signals blur', () => {
    vi.useFakeTimers()
    vi.mocked(window.location.assign).mockImplementation(() => {
      window.dispatchEvent(new Event('blur'))
    })

    renderLanding(loadedState())

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(window.location.assign).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('shows a manual retry after a blocked attempt and keeps download and join-code options', () => {
    vi.useFakeTimers()
    renderLanding(loadedState())

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    expect(screen.getByText("Couldn't open ShieldBattery automatically.")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try opening the app again' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download it for free' })).toBeTruthy()
    expect(screen.getByText('BQ4-XM9')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try opening the app again' }))

    expect(window.location.assign).toHaveBeenCalledTimes(2)

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    expect(screen.getByText("The app didn't open.")).toBeTruthy()
  })

  test('registers detection before invocation and cleans listeners and timer on unmount', () => {
    vi.useFakeTimers()
    const addWindowListener = vi.spyOn(window, 'addEventListener')
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const addDocumentListener = vi.spyOn(document, 'addEventListener')
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
    const order: string[] = []
    vi.mocked(window.location.assign).mockImplementation(() => {
      expect(addWindowListener.mock.calls.some(([type]) => type === 'blur')).toBe(true)
      expect(addDocumentListener.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(
        true,
      )
      order.push('invoke')
    })

    const { unmount } = renderLanding(loadedState())
    const blurListener = addWindowListener.mock.calls.find(([type]) => type === 'blur')?.[1]
    const visibilityListener = addDocumentListener.mock.calls.find(
      ([type]) => type === 'visibilitychange',
    )?.[1]

    expect(order).toEqual(['invoke'])
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(removeWindowListener).toHaveBeenCalledWith('blur', blurListener)
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', visibilityListener)
    expect(vi.getTimerCount()).toBe(0)
  })
})
