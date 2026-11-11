import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import createDeferred from '../../common/async/deferred'
import { GameType } from '../../common/games/game-type'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { createComputer, createHuman } from '../../common/lobbies/slot'
import { makeSbMapId } from '../../common/maps'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { fetchJson } from '../network/fetch'
import { setUserLocalStorageValue } from '../react/state-hooks'
import { RootState } from '../root-reducer'
import { createLobby, joinLobby, setRace } from './action-creators'
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
