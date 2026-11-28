import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import createDeferred from '../../common/async/deferred'
import { GameType } from '../../common/games/game-type'
import { LobbyBestOfJson } from '../../common/lobbies/lobby-best-of'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { createComputer, createHuman } from '../../common/lobbies/slot'
import { makeSbMapId } from '../../common/maps'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { clientId } from '../network/client-id'
import { fetchJson } from '../network/fetch'
import { setUserLocalStorageValue } from '../react/state-hooks'
import { RootState } from '../root-reducer'
import {
  addBestOfResult,
  createLobby,
  joinLobby,
  removeBestOfResult,
  setBestOfGameResult,
  setRace,
  startBestOf,
  updateBestOf,
} from './action-creators'
import lobbyReducer from './lobby-reducer'

vi.mock('../../common/ipc', () => ({
  TypedIpcRenderer: class {
    invoke() {}
  },
}))
vi.mock('../game-server-regions/region-resolution', () => ({
  resolveDesiredRegion: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../network/fetch', () => ({ fetchJson: vi.fn(), encodeBodyAsParams: vi.fn(body => body) }))
vi.mock('../network/site-socket', () => ({ default: {} }))

const LOBBY_ID = makeSbLobbyId('lobby')
const USER_ID = makeSbUserId(1)
const OWN_SLOT = createHuman(USER_ID)
const COMPUTER_SLOT = createComputer()
const CREATE_PARAMS = { name: 'Lobby', map: makeSbMapId('map'), gameType: GameType.Melee }

function getState(userId = USER_ID): RootState {
  const lobby = lobbyReducer(undefined, { type: '@@INIT' } as any)
  const auth = { self: { user: { id: userId } } } as RootState['auth']
  const state: Pick<RootState, 'auth' | 'lobby'> = {
    auth,
    lobby: {
      ...lobby,
      info: {
        ...lobby.info,
        id: LOBBY_ID,
        name: 'Lobby',
        teams: [
          {
            name: 'Players',
            teamId: 0,
            isObserver: false,
            slots: [OWN_SLOT, COMPUTER_SLOT],
            hiddenSlots: [],
          },
        ],
      },
    },
  }
  return state as RootState
}

beforeEach(() => vi.mocked(fetchJson).mockReset().mockResolvedValue(undefined))
afterEach(() => localStorage.clear())

test('host and join requests use the last accepted personal race, including Random', async () => {
  const firstChange = createDeferred<void>()
  vi.mocked(fetchJson).mockReturnValueOnce(firstChange)

  const chooseProtoss = new Promise<void>((onSuccess, onError) => {
    setRace(OWN_SLOT.id, 'p', { onSuccess, onError })(vi.fn(), getState)
  })
  const chooseRandom = new Promise<void>((onSuccess, onError) => {
    setRace(OWN_SLOT.id, 'r', { onSuccess, onError })(vi.fn(), getState)
  })
  const join = new Promise<void>((onSuccess, onError) => {
    joinLobby(LOBBY_ID, {}, { onSuccess, onError })(vi.fn(), getState)
  })
  firstChange.resolve()
  await Promise.all([chooseProtoss, chooseRandom, join])

  await new Promise((onSuccess, onError) => {
    createLobby(CREATE_PARAMS, { onSuccess, onError })(vi.fn(), getState)
  })

  expect(vi.mocked(fetchJson).mock.calls.map(([, options]) => options?.body)).toEqual([
    expect.objectContaining({ slotId: OWN_SLOT.id, race: 'p' }),
    expect.objectContaining({ slotId: OWN_SLOT.id, race: 'r' }),
    expect.objectContaining({ race: 'r' }),
    expect.objectContaining({ race: 'r' }),
  ])
})

test('computer edits and rejected personal edits leave the saved race alone', async () => {
  setUserLocalStorageValue(USER_ID, 'lobbies.lastRace', 't')
  const error = new Error('race change rejected')
  vi.mocked(fetchJson).mockResolvedValueOnce(undefined).mockRejectedValueOnce(error)

  await new Promise<void>((onSuccess, onError) => {
    setRace(COMPUTER_SLOT.id, 'p', { onSuccess, onError })(vi.fn(), getState)
  })
  await expect(
    new Promise<void>((onSuccess, onError) => {
      setRace(OWN_SLOT.id, 'z', { onSuccess, onError })(vi.fn(), getState)
    }),
  ).rejects.toBe(error)

  await new Promise<void>((onSuccess, onError) => {
    joinLobby(LOBBY_ID, {}, { onSuccess, onError })(vi.fn(), getState)
  })
  expect(fetchJson).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ body: expect.objectContaining({ race: 't' }) }),
  )

  await new Promise<void>((onSuccess, onError) => {
    joinLobby(LOBBY_ID, {}, { onSuccess, onError })(vi.fn(), () => getState(makeSbUserId(2)))
  })
  expect(fetchJson).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ body: expect.objectContaining({ race: undefined }) }),
  )
})

/** Reads a multipart best-of body back as the JSON field it carries and the logo file, if any. */
function readBestOfForm(body: unknown, field: 'series' | 'changes') {
  expect(body).toBeInstanceOf(FormData)
  const form = body as FormData
  return {
    fields: [...form.keys()].sort(),
    request: JSON.parse(form.get(field) as string),
    logo: form.get('logo'),
  }
}

test('a best-of start is sent as multipart, with the series as JSON and the logo as a file', async () => {
  const logo = new File(['png'], 'logo.png', { type: 'image/png' })
  await new Promise<void>((onSuccess, onError) => {
    startBestOf(
      { length: 3, sides: [[USER_ID], [makeSbUserId(2)]], line1: 'Casters', logo },
      { onSuccess, onError },
    )(vi.fn(), getState)
  })
  await new Promise<void>((onSuccess, onError) => {
    startBestOf(
      { length: 5, title: 'Final', sides: [[USER_ID], [makeSbUserId(2)]], deleteLogo: true },
      { onSuccess, onError },
    )(vi.fn(), getState)
  })

  const [[startUrl, startOptions], [secondUrl, secondOptions]] = vi.mocked(fetchJson).mock.calls
  expect(startUrl).toContain('/lobbies/lobby/start-best-of')
  expect(startOptions?.method).toBe('POST')
  expect(readBestOfForm(startOptions?.body, 'series')).toEqual({
    fields: ['logo', 'series'],
    request: { clientId, length: 3, sides: [[USER_ID], [2]], line1: 'Casters' },
    logo,
  })
  expect(secondUrl).toContain('/lobbies/lobby/start-best-of')
  expect(readBestOfForm(secondOptions?.body, 'series')).toEqual({
    fields: ['series'],
    request: { clientId, length: 5, title: 'Final', sides: [[USER_ID], [2]], deleteLogo: true },
    logo: null,
  })
})

test('a best-of change is sent as multipart, keeping cleared fields as null', async () => {
  const logo = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
  await new Promise<void>((onSuccess, onError) => {
    updateBestOf({ title: null, line2: null }, { onSuccess, onError })(vi.fn(), getState)
  })
  await new Promise<void>((onSuccess, onError) => {
    updateBestOf({ line1: 'Observer', logo }, { onSuccess, onError })(vi.fn(), getState)
  })

  const [[clearUrl, clearOptions], [logoUrl, logoOptions]] = vi.mocked(fetchJson).mock.calls
  expect(clearUrl).toContain('/lobbies/lobby/update-best-of')
  expect(clearOptions?.method).toBe('POST')
  expect(readBestOfForm(clearOptions?.body, 'changes')).toEqual({
    fields: ['changes'],
    request: { clientId, title: null, line2: null },
    logo: null,
  })
  expect(logoUrl).toContain('/lobbies/lobby/update-best-of')
  expect(readBestOfForm(logoOptions?.body, 'changes')).toEqual({
    fields: ['changes', 'logo'],
    request: { clientId, line1: 'Observer' },
    logo,
  })
})

test('best-of corrections answer with the corrected series', async () => {
  const corrected: LobbyBestOfJson = {
    id: 'series',
    length: 3,
    sides: [[USER_ID], [makeSbUserId(2)]],
    games: [
      {
        gameId: 'g1',
        players: [[USER_ID], [makeSbUserId(2)]],
        status: 'won',
        winner: 1,
        setByHost: true,
      },
    ],
  }
  vi.mocked(fetchJson).mockResolvedValue({ bestOf: corrected })

  const answers = await Promise.all([
    new Promise<LobbyBestOfJson>((onSuccess, onError) => {
      setBestOfGameResult(
        'g1',
        { status: 'won', winner: 1 },
        { onSuccess, onError },
      )(vi.fn(), getState)
    }),
    new Promise<LobbyBestOfJson>((onSuccess, onError) => {
      addBestOfResult(0, { onSuccess, onError })(vi.fn(), getState)
    }),
    new Promise<LobbyBestOfJson>((onSuccess, onError) => {
      removeBestOfResult('r1', { onSuccess, onError })(vi.fn(), getState)
    }),
  ])

  expect(answers).toEqual([corrected, corrected, corrected])
  const [[setUrl, setOptions], [addUrl, addOptions], [removeUrl, removeOptions]] =
    vi.mocked(fetchJson).mock.calls
  expect(setUrl).toContain('/lobbies/lobby/set-best-of-game-result')
  // The result is an object, so it goes as JSON rather than as form params.
  expect(JSON.parse(setOptions?.body as string)).toEqual({
    clientId,
    gameId: 'g1',
    result: { status: 'won', winner: 1 },
  })
  expect(addUrl).toContain('/lobbies/lobby/add-best-of-result')
  expect(addOptions?.body).toEqual({ clientId, winner: 0 })
  expect(removeUrl).toContain('/lobbies/lobby/remove-best-of-result')
  expect(removeOptions?.body).toEqual({ clientId, resultId: 'r1' })
})

test('a best-of correction fails when the user is in no lobby', async () => {
  const outOfLobby = () => {
    const state = getState()
    return { ...state, lobby: { ...state.lobby, info: { ...state.lobby.info, name: '' } } }
  }
  await expect(
    new Promise<LobbyBestOfJson>((onSuccess, onError) => {
      addBestOfResult(0, { onSuccess, onError })(vi.fn(), outOfLobby)
    }),
  ).rejects.toThrow('not in a lobby')
  expect(fetchJson).not.toHaveBeenCalled()
})
