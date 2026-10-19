import { beforeEach, describe, expect, test, vi } from 'vitest'
import createDeferred from '../../common/async/deferred'
import { ClientDraftState } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { jotaiStore } from '../jotai-store'
import { fetchJson } from '../network/fetch'
import { RootState } from '../root-reducer'
import { changeDraftRace, lockInDraftRace } from './action-creators'
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
