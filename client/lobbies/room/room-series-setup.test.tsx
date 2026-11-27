import { act, fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { LazyMotion } from 'motion/react'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { Lobby, Team } from '../../../common/lobbies'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import {
  GetRememberedBestOfDisplayNamesResponse,
  GetRememberedBestOfOverlayResponse,
  LobbyServiceErrorCode,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman, createObserver, Slot } from '../../../common/lobbies/slot'
import { MapInfo } from '../../../common/maps'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import createStore from '../../create-store'
import { domMax } from '../../motion-features'
import { RequestHandlingSpec } from '../../network/abortable-thunk'
import { FetchError } from '../../network/fetch-errors'
import { StartBestOfParams, UpdateBestOfParams } from '../action-creators'
import { RoomSeriesSetup } from './room-series-setup'

vi.mock('../../logging/logger', () => ({ default: { error: vi.fn() } }))

vi.hoisted(() => {
  globalThis.requestAnimationFrame = () => 0
  globalThis.cancelAnimationFrame = () => {}
})

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const HOST = makeSbUserId(1)
const ALLY = makeSbUserId(2)
const RIVAL = makeSbUserId(3)
const RIVAL_2 = makeSbUserId(4)
const OBSERVER = makeSbUserId(5)
const USERS: SbUser[] = [
  { id: HOST, name: 'host', created: 0 },
  { id: ALLY, name: 'ally', created: 0 },
  { id: RIVAL, name: 'rival', created: 0 },
  { id: RIVAL_2, name: 'rival2', created: 0 },
  { id: OBSERVER, name: 'observer', created: 0 },
]
const REMEMBERED_LOGO = { url: 'https://cdn.example.com/logo.png', fileName: 'cup.png' }

function makeTeam(name: string, teamId: number, slots: Slot[], isObserver = false): Team {
  return { name, teamId, isObserver, slots, hiddenSlots: [] }
}

function makeLobby(): Lobby {
  const hostSlot = createHuman(HOST, 't')
  return {
    id: makeSbLobbyId('lobby'),
    name: 'Lobby',
    map: { id: 'map', name: 'Map', mapData: { slots: 4, umsSlots: 4 } } as unknown as MapInfo,
    mapQueue: [],
    createdAt: 0,
    gameType: GameType.TopVsBottom,
    gameSubType: 2,
    teams: [
      makeTeam('Top', 1, [hostSlot, createHuman(ALLY, 'z')]),
      makeTeam('Bottom', 2, [createHuman(RIVAL, 'p'), createHuman(RIVAL_2, 'r')]),
      makeTeam('Observers', 0, [createObserver(OBSERVER)], true),
    ],
    bench: [],
    host: hostSlot,
    useLegacyLimits: false,
    starcraftCompatibleReplays: true,
    lockedAlliances: false,
    visibility: 'listed',
  }
}

const RUNNING: LobbyBestOfJson = {
  id: 'series',
  title: 'Grand Final',
  length: 7,
  sides: [
    [HOST, ALLY],
    [RIVAL, RIVAL_2],
  ],
  games: [{ gameId: 'g1', status: 'won', winner: 1 }],
  overlay: { line1: 'Casters  Alice', line2: 'Observer  Bob', logo: REMEMBERED_LOGO },
}

type NamesSpec = RequestHandlingSpec<GetRememberedBestOfDisplayNamesResponse>

function renderPage({
  bestOfs = [],
  answerNamesAtOnce = true,
}: {
  bestOfs?: LobbyBestOfJson[]
  /** Answers every remembered display names lookup as soon as it is made, with none remembered. */
  answerNamesAtOnce?: boolean
} = {}) {
  const store = createStore()
  store.dispatch({ type: '@users/loadUsers', payload: USERS })
  store.dispatch({
    type: '@lobbies/init',
    payload: {
      type: 'init',
      lobby: makeLobby(),
      userInfos: USERS,
      readyUsers: [],
      shuffleCount: 0,
      mapStatuses: [],
      series: [],
      bestOfs,
    },
  })

  let rememberedSpec: RequestHandlingSpec<GetRememberedBestOfOverlayResponse> | undefined
  const onLoadRememberedOverlay = vi.fn(
    (spec: RequestHandlingSpec<GetRememberedBestOfOverlayResponse>) => {
      rememberedSpec = spec
    },
  )
  const pendingNameLookups: NamesSpec[] = []
  const onLoadRememberedDisplayNames = vi.fn(
    (_userIds: ReadonlyArray<SbUserId>, spec: NamesSpec) => {
      if (answerNamesAtOnce) {
        spec.onSuccess({ displayNames: [] })
      } else {
        pendingNameLookups.push(spec)
      }
    },
  )
  const onStartBestOf = vi.fn<(r: StartBestOfParams, s: RequestHandlingSpec<void>) => void>()
  const onUpdateBestOf = vi.fn<(r: UpdateBestOfParams, s: RequestHandlingSpec<void>) => void>()
  const onClose = vi.fn()

  render(
    <ReduxProvider store={store}>
      <LazyMotion features={domMax}>
        <RoomSeriesSetup
          onClose={onClose}
          onStartBestOf={onStartBestOf}
          onUpdateBestOf={onUpdateBestOf}
          onEndBestOf={vi.fn()}
          onLoadRememberedOverlay={onLoadRememberedOverlay}
          onLoadRememberedDisplayNames={onLoadRememberedDisplayNames}
        />
      </LazyMotion>
    </ReduxProvider>,
  )

  return {
    store,
    onLoadRememberedOverlay,
    onLoadRememberedDisplayNames,
    onStartBestOf,
    onUpdateBestOf,
    onClose,
    answerRemembered: (remembered: GetRememberedBestOfOverlayResponse) =>
      act(() => rememberedSpec!.onSuccess(remembered)),
    failRemembered: () => act(() => rememberedSpec!.onError(new Error('offline'))),
    answerNames: (displayNames: GetRememberedBestOfDisplayNamesResponse['displayNames']) =>
      act(() => pendingNameLookups.shift()!.onSuccess({ displayNames })),
    failNames: () => act(() => pendingNameLookups.shift()!.onError(new Error('offline'))),
  }
}

function input(testId: string): HTMLInputElement {
  return screen.getByTestId(testId) as HTMLInputElement
}

function click(testId: string) {
  fireEvent.click(screen.getByTestId(testId))
}

describe('RoomSeriesSetup', () => {
  test('a new series opens with the remembered lines and logo and the seated sides', () => {
    const page = renderPage()
    expect(page.onLoadRememberedOverlay).toHaveBeenCalledTimes(1)
    expect((screen.getByTestId('series-setup-start-button') as HTMLButtonElement).disabled).toBe(
      true,
    )

    page.answerRemembered({
      line1: 'Casters  Alice',
      line2: 'Observer  Bob',
      logo: REMEMBERED_LOGO,
    })

    expect(input('series-setup-title-input').value).toBe('')
    expect(input('series-setup-line1-input').value).toBe('Casters  Alice')
    expect(input('series-setup-line2-input').value).toBe('Observer  Bob')
    expect(screen.getByText('cup.png')).toBeTruthy()
    expect(screen.getAllByTestId('series-setup-side-player')).toHaveLength(4)

    click('series-setup-length-5')
    click('series-setup-start-button')
    expect(page.onStartBestOf).toHaveBeenCalledWith(
      {
        length: 5,
        sides: [
          [HOST, ALLY],
          [RIVAL, RIVAL_2],
        ],
        line1: 'Casters  Alice',
        line2: 'Observer  Bob',
      },
      expect.anything(),
    )
  })

  test('removing the remembered logo starts the series without one', () => {
    const page = renderPage()
    page.answerRemembered({ logo: REMEMBERED_LOGO })

    click('series-setup-logo-remove')
    expect(screen.getByText('No logo')).toBeTruthy()
    click('series-setup-start-button')
    expect(page.onStartBestOf.mock.calls[0][0]).toMatchObject({ deleteLogo: true })
  })

  test('a failed load still lets the host start, and leaves the logo to the server', () => {
    const page = renderPage()
    page.failRemembered()

    expect(screen.getByText("Your last lines and logo couldn't be loaded.")).toBeTruthy()
    click('series-setup-start-button')
    const request = page.onStartBestOf.mock.calls[0][0]
    expect(request).not.toHaveProperty('deleteLogo')
    expect(request).not.toHaveProperty('logo')
  })

  test('a refused start keeps the page open with what the host entered and says why', () => {
    const page = renderPage()
    page.answerRemembered({})
    fireEvent.change(input('series-setup-title-input'), { target: { value: 'Final' } })
    click('series-setup-start-button')

    const spec = page.onStartBestOf.mock.calls[0][1]
    act(() =>
      spec.onError(
        new FetchError(
          new Response(null, { status: 409 }),
          JSON.stringify({ code: LobbyServiceErrorCode.BestOfAlreadyRunning }),
        ),
      ),
    )

    expect(page.onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('series-setup-request-error').textContent).toContain(
      'A series is already running',
    )
    expect(input('series-setup-title-input').value).toBe('Final')
  })

  test('a logo the server refuses is explained on the logo slot', () => {
    const page = renderPage()
    page.answerRemembered({ logo: REMEMBERED_LOGO })
    click('series-setup-start-button')

    const spec = page.onStartBestOf.mock.calls[0][1]
    act(() =>
      spec.onError(
        new FetchError(
          new Response(null, { status: 400 }),
          JSON.stringify({ code: LobbyServiceErrorCode.BestOfLogoInappropriate }),
        ),
      ),
    )

    expect(screen.getByTestId('series-setup-logo-error').textContent).toContain(
      "This image can't be used as a logo. Choose a different one.",
    )
    expect(screen.queryByTestId('series-setup-request-error')).toBeNull()
  })

  test('a start that is accepted returns to the room', () => {
    const page = renderPage()
    page.answerRemembered({})
    click('series-setup-start-button')
    act(() => page.onStartBestOf.mock.calls[0][1].onSuccess())
    expect(page.onClose).toHaveBeenCalledTimes(1)
  })

  test('stays a start form when a series starts underneath it', () => {
    const page = renderPage()
    page.answerRemembered({})
    act(() => {
      page.store.dispatch({
        type: '@lobbies/updateBestOfStarted',
        payload: { type: 'bestOfStarted', bestOf: RUNNING },
      })
    })

    expect(screen.getByTestId('series-setup-start-button')).toBeTruthy()
    expect(screen.queryByTestId('series-setup-fixed-length')).toBeNull()
  })

  describe('while a series runs', () => {
    test('shows its title, lines and logo, with the length fixed', () => {
      const page = renderPage({ bestOfs: [RUNNING] })

      expect(page.onLoadRememberedOverlay).not.toHaveBeenCalled()
      expect(input('series-setup-title-input').value).toBe('Grand Final')
      expect(input('series-setup-line1-input').value).toBe('Casters  Alice')
      expect(screen.getByTestId('series-setup-fixed-length').textContent).toBe('Best of 7')
      expect(screen.queryByTestId('series-setup-length')).toBeNull()
      expect(screen.getByText('cup.png')).toBeTruthy()
      expect(screen.getByTestId('series-setup-end-button')).toBeTruthy()
      expect(
        screen.getByText('Best of 7 · host, ally 0–1 rival, rival2 · Grand Final'),
      ).toBeTruthy()
    })

    test('saves only what changed', () => {
      const page = renderPage({ bestOfs: [RUNNING] })
      fireEvent.change(input('series-setup-line2-input'), { target: { value: '' } })
      click('series-setup-remove-player-2')
      click('series-setup-save-button')

      expect(page.onUpdateBestOf).toHaveBeenCalledWith(
        { sides: [[HOST], [RIVAL, RIVAL_2]], line2: null },
        expect.anything(),
      )
    })

    test('returns to the room without a request when nothing changed', () => {
      const page = renderPage({ bestOfs: [RUNNING] })
      click('series-setup-save-button')

      expect(page.onUpdateBestOf).not.toHaveBeenCalled()
      expect(page.onClose).toHaveBeenCalledTimes(1)
    })

    test('shows its names, which win over remembered ones, and saves a rename', () => {
      const page = renderPage({
        bestOfs: [
          {
            ...RUNNING,
            sideNames: ['Nexus', null],
            displayNames: [{ userId: HOST, name: 'Rhynso' }],
          },
        ],
        answerNamesAtOnce: false,
      })

      expect(page.onLoadRememberedDisplayNames).toHaveBeenCalledWith(
        [ALLY, RIVAL, RIVAL_2],
        expect.anything(),
      )
      page.answerNames([
        { userId: HOST, name: 'OldHandle' },
        { userId: RIVAL, name: 'tec27' },
      ])
      expect(input('series-setup-side-name-1').value).toBe('Nexus')
      expect(input(`series-setup-shown-as-${HOST}`).value).toBe('Rhynso')
      expect(input(`series-setup-shown-as-${RIVAL}`).value).toBe('tec27')

      fireEvent.change(input('series-setup-side-name-2'), { target: { value: 'Ironclad' } })
      click('series-setup-save-button')
      expect(page.onUpdateBestOf).toHaveBeenCalledWith(
        {
          sideNames: ['Nexus', 'Ironclad'],
          displayNames: [{ userId: RIVAL, name: 'tec27' }],
        },
        expect.anything(),
      )
    })
  })

  describe('names', () => {
    test('fills remembered names into untouched fields and starts with names and side names', () => {
      const page = renderPage({ answerNamesAtOnce: false })
      page.answerRemembered({})
      expect(page.onLoadRememberedDisplayNames).toHaveBeenCalledWith(
        [HOST, ALLY, RIVAL, RIVAL_2],
        expect.anything(),
      )
      expect(input(`series-setup-shown-as-${HOST}`).placeholder).toBe('host')
      expect((screen.getByTestId('series-setup-start-button') as HTMLButtonElement).disabled).toBe(
        true,
      )

      // Typed before the remembered names land, so the remembered one doesn't replace it.
      fireEvent.change(input(`series-setup-shown-as-${ALLY}`), { target: { value: 'Mine' } })
      page.answerNames([
        { userId: HOST, name: 'Rhynso' },
        { userId: ALLY, name: 'Theirs' },
        { userId: RIVAL, name: 'tec27' },
      ])
      expect(input(`series-setup-shown-as-${HOST}`).value).toBe('Rhynso')
      expect(input(`series-setup-shown-as-${ALLY}`).value).toBe('Mine')

      fireEvent.change(input(`series-setup-shown-as-${RIVAL}`), { target: { value: '' } })
      fireEvent.change(input('series-setup-side-name-1'), { target: { value: ' Nexus ' } })
      click('series-setup-start-button')

      expect(page.onStartBestOf.mock.calls[0][0]).toEqual({
        length: 3,
        sides: [
          [HOST, ALLY],
          [RIVAL, RIVAL_2],
        ],
        sideNames: ['Nexus', null],
        displayNames: [
          { userId: HOST, name: 'Rhynso' },
          { userId: ALLY, name: 'Mine' },
          { userId: RIVAL, name: null },
        ],
      })
      expect(screen.getByText('Best of 3 · Nexus vs rival, rival2')).toBeTruthy()
    })

    test('a failed load leaves the fields empty and usable and sends only what was typed', () => {
      const page = renderPage({ answerNamesAtOnce: false })
      page.answerRemembered({})
      page.failNames()

      expect(screen.getByText("Your remembered “Shown as” names couldn't be loaded.")).toBeTruthy()
      expect(input(`series-setup-shown-as-${HOST}`).value).toBe('')
      fireEvent.change(input(`series-setup-shown-as-${RIVAL}`), { target: { value: 'tec27' } })
      click('series-setup-start-button')

      expect(page.onStartBestOf.mock.calls[0][0].displayNames).toEqual([
        { userId: RIVAL, name: 'tec27' },
      ])
    })

    test('adding someone looks up their remembered name', () => {
      const page = renderPage({ answerNamesAtOnce: false })
      page.answerRemembered({})
      page.answerNames([])

      click('series-setup-add-player-1')
      click(`series-setup-add-player-option-${OBSERVER}`)
      expect(page.onLoadRememberedDisplayNames).toHaveBeenLastCalledWith(
        [OBSERVER],
        expect.anything(),
      )
      page.answerNames([{ userId: OBSERVER, name: 'Artosis' }])
      expect(input(`series-setup-shown-as-${OBSERVER}`).value).toBe('Artosis')
    })

    test('text that the server would refuse is explained on its field and blocks the start', () => {
      const page = renderPage()
      page.answerRemembered({})

      fireEvent.change(input('series-setup-side-name-2'), { target: { value: 'x'.repeat(25) } })
      expect(screen.getByText('At most 24 characters')).toBeTruthy()
      expect((screen.getByTestId('series-setup-start-button') as HTMLButtonElement).disabled).toBe(
        true,
      )

      fireEvent.change(input('series-setup-side-name-2'), { target: { value: 'x'.repeat(24) } })
      fireEvent.change(input(`series-setup-shown-as-${HOST}`), {
        target: { value: 'Rhyn​so' },
      })
      expect(screen.getByText("Contains characters that can't be used")).toBeTruthy()
      expect((screen.getByTestId('series-setup-start-button') as HTMLButtonElement).disabled).toBe(
        true,
      )

      fireEvent.change(input(`series-setup-shown-as-${HOST}`), {
        target: { value: '🛡'.repeat(16) },
      })
      expect((screen.getByTestId('series-setup-start-button') as HTMLButtonElement).disabled).toBe(
        false,
      )
    })
  })
})
