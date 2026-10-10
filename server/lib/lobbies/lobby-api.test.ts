import { RouterContext } from '@koa/router'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  LobbyJoinErrorCode,
  LobbyPreviewJson,
  LobbyServiceErrorCode,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { routeMiddlewareMetadata } from '../http/route-decorators'
import ensureLoggedIn from '../session/ensure-logged-in'
import { findUsersById } from '../users/user-model'
import { ClientSocketsManager } from '../websockets/socket-groups'
import { convertLobbyServiceError, LobbyApi } from './lobby-api'
import { LobbyService, LobbyServiceError } from './lobby-service'

vi.mock('../users/user-model', async () => {
  const actual = await vi.importActual<typeof import('../users/user-model')>('../users/user-model')
  return { ...actual, findUsersById: vi.fn() }
})

const findUsersByIdMock = asMockedFunction(findUsersById)

/**
 * The status and response-body code the client must receive for each service failure. This table is
 * the HTTP API's wire contract for lobby errors: a new `LobbyServiceErrorCode` fails to compile
 * until it's added here, and a mapping change fails the test until the table agrees.
 *
 * Failures without a client-facing join code carry their service code in the body instead.
 */
const EXPECTED_ERROR_MAPPING: Record<
  LobbyServiceErrorCode,
  { status: number; bodyCode?: LobbyJoinErrorCode }
> = {
  [LobbyServiceErrorCode.AlreadyInActivity]: { status: 409 },
  [LobbyServiceErrorCode.AlreadyInSlot]: { status: 409 },
  [LobbyServiceErrorCode.AlreadyStarted]: { status: 409 },
  [LobbyServiceErrorCode.Banned]: { status: 409, bodyCode: LobbyJoinErrorCode.Banned },
  [LobbyServiceErrorCode.ChatRestricted]: { status: 403 },
  [LobbyServiceErrorCode.ComputerInObserverSlot]: { status: 400 },
  [LobbyServiceErrorCode.CountingDown]: { status: 409 },
  [LobbyServiceErrorCode.ForcedRace]: { status: 403 },
  [LobbyServiceErrorCode.GameInProgress]: { status: 409 },
  [LobbyServiceErrorCode.InvalidGameSubType]: { status: 400 },
  [LobbyServiceErrorCode.InvalidGameType]: { status: 400 },
  [LobbyServiceErrorCode.InvalidMap]: { status: 400 },
  [LobbyServiceErrorCode.InvalidSlotId]: { status: 400 },
  [LobbyServiceErrorCode.InvalidSlotOperation]: { status: 400 },
  [LobbyServiceErrorCode.InvalidSlotType]: { status: 400 },
  [LobbyServiceErrorCode.InvalidTeamLayout]: { status: 409 },
  [LobbyServiceErrorCode.JoinAlreadyInActivity]: {
    status: 409,
    bodyCode: LobbyJoinErrorCode.AlreadyInActivity,
  },
  [LobbyServiceErrorCode.LobbyFull]: { status: 409, bodyCode: LobbyJoinErrorCode.Full },
  [LobbyServiceErrorCode.NoActiveClient]: { status: 400 },
  [LobbyServiceErrorCode.NoLobby]: { status: 404, bodyCode: LobbyJoinErrorCode.NoLongerOpen },
  [LobbyServiceErrorCode.NotCountingDown]: { status: 409 },
  [LobbyServiceErrorCode.NotEnoughSides]: { status: 400 },
  [LobbyServiceErrorCode.NotEveryoneReady]: { status: 409 },
  [LobbyServiceErrorCode.NotHost]: { status: 403 },
  [LobbyServiceErrorCode.NotInLobby]: { status: 400 },
  [LobbyServiceErrorCode.NotObserverSlot]: { status: 400 },
  [LobbyServiceErrorCode.NotOwnSlot]: { status: 403 },
  [LobbyServiceErrorCode.NotSeated]: { status: 400 },
  [LobbyServiceErrorCode.NotSlotController]: { status: 403 },
  [LobbyServiceErrorCode.ObserversFull]: {
    status: 409,
    bodyCode: LobbyJoinErrorCode.ObserversFull,
  },
  [LobbyServiceErrorCode.TargetNoActiveClient]: { status: 409 },
  [LobbyServiceErrorCode.UserOffline]: { status: 400 },
}

/**
 * Runs the converter over an error and returns whatever it threw, so a test can assert on the HTTP
 * status and the response body it would produce.
 */
function convert(err: unknown): any {
  try {
    convertLobbyServiceError(err)
  } catch (converted) {
    return converted
  }
  throw new Error('the converter returned without throwing')
}

describe('lobbies/lobby-api/convertLobbyServiceError', () => {
  test.each(Object.values(LobbyServiceErrorCode))('maps %s', code => {
    const expected = EXPECTED_ERROR_MAPPING[code]

    const converted = convert(new LobbyServiceError(code, 'test message'))

    expect(converted.status).toBe(expected.status)
    expect(converted.message).toBe('test message')
    expect(converted.payload).toEqual({ code: expected.bodyCode ?? code })
  })

  test('passes non-service errors through untouched', () => {
    const err = new Error('something else entirely')
    expect(convert(err)).toBe(err)
  })
})

describe('lobbies/lobby-api/LobbyApi#getSeats', () => {
  const LOBBY_PRETTY_ID = encodePrettyId('5eed0000-0000-0000-0000-000000000042')
  const HOST: SbUser = { id: makeSbUserId(1), name: 'HostUser', created: 0 }
  const GUEST: SbUser = { id: makeSbUserId(2), name: 'GuestUser', created: 0 }
  const WATCHER_ID = makeSbUserId(3)

  const getPreview = vi.fn<LobbyService['getPreview']>()
  const api = new LobbyApi({ getPreview } as unknown as LobbyService, {} as ClientSocketsManager)

  function makeCtx(): RouterContext {
    return { params: { lobbyId: LOBBY_PRETTY_ID }, query: {} } as any
  }

  beforeEach(() => {
    getPreview.mockReset()
    findUsersByIdMock.mockReset()
  })

  test('returns player seats in team then slot order, without closed or observer seats', async () => {
    getPreview.mockReturnValueOnce({
      teams: [
        {
          name: 'Team 1',
          isObserver: false,
          slots: [
            { type: 'human', userId: HOST.id, race: 'p' },
            { type: 'closed' },
            { type: 'open' },
          ],
        },
        {
          name: 'Team 2',
          isObserver: false,
          slots: [
            { type: 'computer', race: 'z' },
            { type: 'human', userId: GUEST.id, race: 't' },
          ],
        },
        {
          name: 'Observers',
          isObserver: true,
          slots: [{ type: 'observer', userId: WATCHER_ID }, { type: 'open' }],
        },
      ],
    } as Partial<LobbyPreviewJson> as LobbyPreviewJson)
    findUsersByIdMock.mockResolvedValueOnce([HOST, GUEST])

    const response = await api.getSeats(makeCtx())

    expect(getPreview).toHaveBeenCalledWith(makeSbLobbyId(LOBBY_PRETTY_ID))
    expect(response.seats).toEqual([
      { type: 'human', userId: HOST.id },
      { type: 'open' },
      { type: 'computer' },
      { type: 'human', userId: GUEST.id },
    ])
    expect(findUsersByIdMock).toHaveBeenCalledWith([HOST.id, GUEST.id])
    expect(response.users).toEqual([HOST, GUEST])
  })

  test('responds 404 for a lobby that does not exist', async () => {
    getPreview.mockReturnValueOnce(undefined)

    await expect(api.getSeats(makeCtx())).rejects.toMatchObject({ status: 404 })
  })

  test('refuses callers without a session', async () => {
    const middleware = routeMiddlewareMetadata.getEntryValue(
      LobbyApi.prototype as unknown as Record<string, unknown>,
      'getSeats',
    )
    expect(middleware?.[0]).toBe(ensureLoggedIn)

    const next = vi.fn()
    await expect(ensureLoggedIn({ session: undefined } as any, next)).rejects.toMatchObject({
      status: 401,
    })
    expect(next).not.toHaveBeenCalled()
  })
})
