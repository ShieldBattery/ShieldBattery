import { beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred from '../../common/async/deferred'
import {
  ClientDraftState,
  defaultPreferences,
  GetPreferencesResponse,
  MatchmakingType,
} from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { jotaiStore } from '../jotai-store'
import { fetchJson } from '../network/fetch'
import { RootState } from '../root-reducer'
import { changeDraftRace, lockInDraftRace, updateMatchmakingPreferences } from './action-creators'
import { draftStateAtom, resetDraftState, updateCurrentPickerAtom } from './draft-atoms'

vi.mock('../../common/ipc', () => ({ TypedIpcRenderer: class {} }))
vi.mock('../game-server-regions/region-resolution', () => ({ resolveDesiredRegion: vi.fn() }))
vi.mock('../i18n/i18next', () => ({ default: { t: vi.fn() } }))
vi.mock('../logging/logger', () => ({ default: { error: vi.fn() } }))
vi.mock('../network/fetch', () => ({ fetchJson: vi.fn(), encodeBodyAsParams: vi.fn() }))
vi.mock('../snackbars/snackbar-controller-registry', () => ({ externalShowSnackbar: vi.fn() }))

const USER_ID = makeSbUserId(1)
const REQUESTS = [
  {
    name: 'provisional pick',
    create: changeDraftRace,
    expectedPlayer: { hasLocked: false, provisionalRace: 'z' },
  },
  {
    name: 'locked pick',
    create: lockInDraftRace,
    expectedPlayer: { hasLocked: true, finalRace: 'z' },
  },
]

function startDraft() {
  resetDraftState(jotaiStore)
  jotaiStore.set(draftStateAtom, {
    mapId: 'map' as ClientDraftState['mapId'],
    myTeamIndex: 0,
    currentPicker: { team: 0, slot: 0 },
    ownTeam: { players: [{ userId: USER_ID, provisionalRace: 'p', hasLocked: false }] },
    opponentTeam: { players: [{ index: 0, nameIndex: 0, hasLocked: false }] },
    pickOrder: [
      [0, 0],
      [1, 0],
    ],
    isCompleted: false,
  })
}

describe('draft race requests', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
    startDraft()
  })

  test.each(REQUESTS)(
    '$name cannot apply a delayed response to a replacement draft',
    async ({ create }) => {
      const response = createDeferred<void>()
      vi.mocked(fetchJson).mockReturnValueOnce(response)
      const completed = new Promise<void>((resolve, reject) => {
        create({ race: 'z' }, { onSuccess: resolve, onError: reject })(
          vi.fn(),
          () =>
            ({
              auth: { self: { user: { id: USER_ID } } },
            }) as RootState,
        )
      })

      startDraft()
      const replacement = jotaiStore.get(draftStateAtom)
      response.resolve()
      await completed

      expect(jotaiStore.get(draftStateAtom)).toBe(replacement)
    },
  )

  test.each(REQUESTS)(
    '$name applies its response while its draft is still active',
    async ({ create, expectedPlayer }) => {
      const response = createDeferred<void>()
      vi.mocked(fetchJson).mockReturnValueOnce(response)
      const completed = new Promise<void>((resolve, reject) => {
        create({ race: 'z' }, { onSuccess: resolve, onError: reject })(
          vi.fn(),
          () =>
            ({
              auth: { self: { user: { id: USER_ID } } },
            }) as RootState,
        )
      })
      jotaiStore.set(updateCurrentPickerAtom, { team: 0, slot: 0 })
      response.resolve()
      await completed

      const player = jotaiStore.get(draftStateAtom)!.ownTeam.players[0]
      expect(player).toMatchObject(expectedPlayer)
    },
  )
})

describe('matchmaking preference saves', () => {
  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  const mapPools: RootState['mapPools'] = {
    byType: new Map(
      Object.values(MatchmakingType).map(type => [
        type,
        { id: 1, matchmakingType: type, maps: [], maxVetoCount: 0, startDate: 0 },
      ]),
    ),
    isRequestingByType: new Map(),
    lastErrorByType: new Map(),
  }
  const getState = () => ({ mapPools }) as RootState

  function response(type = MatchmakingType.Match1v1): GetPreferencesResponse {
    return {
      preferences: defaultPreferences(type, USER_ID),
      currentMapPoolId: 1,
      mapInfos: [],
      selected: false,
    }
  }

  test('saves a race choice after an earlier map-only edit finishes', async () => {
    const mapSave = createDeferred<GetPreferencesResponse>()
    const raceSave = createDeferred<GetPreferencesResponse>()
    vi.mocked(fetchJson).mockReturnValueOnce(mapSave).mockReturnValueOnce(raceSave)
    const dispatch = vi.fn()
    const type = MatchmakingType.Match1v1
    updateMatchmakingPreferences(type, { userId: USER_ID, matchmakingType: type, race: null })(
      dispatch,
      getState,
    )
    updateMatchmakingPreferences(type, { userId: USER_ID, matchmakingType: type, race: 'p' })(
      dispatch,
      getState,
    )
    expect(fetchJson).toHaveBeenCalledTimes(1)
    mapSave.resolve({ ...response(), preferences: { ...response().preferences, race: null } })
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2))
    expect(JSON.parse(vi.mocked(fetchJson).mock.calls[1][1]!.body as string).race).toBe('p')
    raceSave.resolve({ ...response(), preferences: { ...response().preferences, race: 'p' } })
    const results = await Promise.all(
      dispatch.mock.calls
        .map(([action]) => action)
        .filter(action => action.type === '@matchmaking/updatePreferences')
        .map(action => action.payload),
    )
    expect(results.map(result => result.preferences.race)).toEqual([null, 'p'])
  })

  test('a failed save does not block the next edit', async () => {
    const failedSave = createDeferred<GetPreferencesResponse>()
    const nextSave = createDeferred<GetPreferencesResponse>()
    vi.mocked(fetchJson).mockReturnValueOnce(failedSave).mockReturnValueOnce(nextSave)
    const dispatch = vi.fn()
    const type = MatchmakingType.Match1v1
    const prefs = { userId: USER_ID, matchmakingType: type, race: null } as const
    updateMatchmakingPreferences(type, prefs)(dispatch, getState)
    updateMatchmakingPreferences(type, { ...prefs, race: 'r' })(dispatch, getState)
    failedSave.reject(new Error('Network request failed'))
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2))
    nextSave.resolve(response())
    const results = await Promise.allSettled(
      dispatch.mock.calls
        .map(([action]) => action)
        .filter(action => action.type === '@matchmaking/updatePreferences')
        .map(action => action.payload),
    )
    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
  })

  test('different modes save independently', async () => {
    const soloSave = createDeferred<GetPreferencesResponse>()
    const teamSave = createDeferred<GetPreferencesResponse>()
    vi.mocked(fetchJson).mockReturnValueOnce(soloSave).mockReturnValueOnce(teamSave)
    const dispatch = vi.fn()
    for (const type of [MatchmakingType.Match1v1, MatchmakingType.Match2v2Bgh]) {
      updateMatchmakingPreferences(type, {
        userId: USER_ID,
        matchmakingType: type,
        race: null,
      })(dispatch, getState)
    }
    expect(fetchJson).toHaveBeenCalledTimes(2)
    soloSave.resolve(response())
    teamSave.resolve(response(MatchmakingType.Match2v2Bgh))
    await Promise.all(dispatch.mock.calls.map(([action]) => action.payload))
  })
})
