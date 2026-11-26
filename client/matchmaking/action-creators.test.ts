import { beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred from '../../common/async/deferred'
import { makeSbMapId } from '../../common/maps'
import {
  ClientDraftState,
  defaultPreferences,
  GetPreferencesResponse,
  MatchmakingPreferencesDraft,
  MatchmakingServiceErrorCode,
  MatchmakingType,
} from '../../common/matchmaking'
import { GetMatchmakingMapPoolResponse } from '../../common/matchmaking/matchmaking-map-pools'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { DialogType } from '../dialogs/dialog-type'
import { jotaiStore } from '../jotai-store'
import { fetchJson } from '../network/fetch'
import { FetchError } from '../network/fetch-errors'
import { RootState } from '../root-reducer'
import {
  changeDraftRace,
  lockInDraftRace,
  queueForMatchmaking,
  QueueForMatchmakingResult,
  updateMatchmakingPreferences,
} from './action-creators'
import { draftStateAtom, resetDraftState, updateCurrentPickerAtom } from './draft-atoms'
import mapPoolReducer from './map-pool-reducer'

vi.mock('../../common/ipc', () => ({
  TypedIpcRenderer: class {
    invoke() {
      return undefined
    }
  },
}))
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
    matchId: 'match-1',
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
    changesByType: new Map(),
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

describe('queueForMatchmaking', () => {
  const type = MatchmakingType.Match1v1
  const oldMap = makeSbMapId('old')
  const newMap = makeSbMapId('new')

  function poolResponse(id: number, maps = [oldMap]): GetMatchmakingMapPoolResponse {
    return {
      pool: { id, matchmakingType: type, maps, maxVetoCount: 3, startDate: 0 },
      mapInfos: [],
      changes:
        id === 1
          ? undefined
          : { addedMaps: [newMap], removedMaps: [], previousMapCount: 1, previousMaxVetoCount: 3 },
    }
  }

  function mapPoolChangedError() {
    return new FetchError(
      new Response('', { status: 409 }),
      JSON.stringify({ code: MatchmakingServiceErrorCode.MapPoolChanged }),
    )
  }

  function setup({
    prefs = defaultPreferences(type, USER_ID, 1),
    findResults,
    currentPool,
  }: {
    prefs?: MatchmakingPreferencesDraft
    findResults: Array<() => Promise<void>>
    currentPool: GetMatchmakingMapPoolResponse
  }) {
    let mapPools = mapPoolReducer(undefined, { type: '@init' })
    mapPools = mapPoolReducer(mapPools, {
      type: '@matchmaking/getCurrentMapPool',
      payload: poolResponse(1),
      meta: { type },
    } as any)
    const actions: any[] = []
    const dispatch = vi.fn((action: any) => {
      actions.push(action)
      mapPools = mapPoolReducer(mapPools, action)
    })
    const getState = () =>
      ({
        matchmakingPreferences: { byType: new Map([[type, { preferences: prefs }]]) },
        mapPools,
      }) as unknown as RootState

    vi.mocked(fetchJson).mockImplementation(async (url: string) => {
      if (url.endsWith('matchmaking/find')) {
        const next = findResults.shift()
        if (!next) throw new Error('Unexpected find request')
        return next()
      }
      return currentPool as any
    })

    const run = () =>
      new Promise<QueueForMatchmakingResult>((resolve, reject) => {
        queueForMatchmaking([type], { onSuccess: resolve, onError: reject })(dispatch, getState)
      })
    const openedDialogs = () =>
      actions.filter(a => a.type === '@dialogs/open').map(a => a.payload.type as DialogType)
    const findRequests = () =>
      vi.mocked(fetchJson).mock.calls.filter(([url]) => String(url).endsWith('matchmaking/find'))

    return { run, openedDialogs, findRequests }
  }

  beforeEach(() => {
    vi.mocked(fetchJson).mockReset()
  })

  test('searches right away when nothing needs review', async () => {
    const { run, openedDialogs, findRequests } = setup({
      findResults: [async () => {}],
      currentPool: poolResponse(1),
    })
    await expect(run()).resolves.toBe('queued')
    expect(findRequests()).toHaveLength(1)
    expect(openedDialogs()).toEqual([])
  })

  test('opens the settings dialog instead of searching when a race is missing', async () => {
    const { run, openedDialogs, findRequests } = setup({
      prefs: { ...defaultPreferences(type, USER_ID, 1), race: null },
      findResults: [],
      currentPool: poolResponse(1),
    })
    await expect(run()).resolves.toBe('reviewing')
    expect(findRequests()).toHaveLength(0)
    expect(openedDialogs()).toEqual([DialogType.FindMatchSettings])
  })

  test('reloads the pools and asks for review when the server reports a pool change', async () => {
    const { run, openedDialogs, findRequests } = setup({
      findResults: [() => Promise.reject(mapPoolChangedError())],
      currentPool: poolResponse(2, [oldMap, newMap]),
    })
    await expect(run()).resolves.toBe('reviewing')
    expect(findRequests()).toHaveLength(1)
    expect(openedDialogs()).toEqual([DialogType.FindMatchSettings])
  })

  test('shows the error when the server still reports a pool change after a reload', async () => {
    const { run, openedDialogs, findRequests } = setup({
      findResults: [
        () => Promise.reject(mapPoolChangedError()),
        () => Promise.reject(mapPoolChangedError()),
      ],
      currentPool: poolResponse(1),
    })
    await expect(run()).rejects.toBeInstanceOf(FetchError)
    expect(findRequests()).toHaveLength(2)
    expect(openedDialogs()).toEqual([DialogType.Simple])
  })
})
