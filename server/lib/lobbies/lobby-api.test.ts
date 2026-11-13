import { RouterContext } from '@koa/router'
import { describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { BenchedUser, Lobby } from '../../../common/lobbies'
import {
  InviteToLobbyErrorCode,
  LobbyJoinErrorCode,
  LobbyServiceErrorCode,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId, SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman, createOpen } from '../../../common/lobbies/slot'
import { NotificationType } from '../../../common/notifications'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { findUserById } from '../users/user-model'
import { convertLobbyServiceError, LobbyApi } from './lobby-api'
import { LobbyServiceError } from './lobby-service'

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
  [LobbyServiceErrorCode.MapNotDownloaded]: { status: 409 },
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

const SENDER_ID = makeSbUserId(2)
const TARGET_ID = makeSbUserId(3)
const LOBBY_ID: SbLobbyId = makeSbLobbyId('aaaaaaaaaaaaaaaaaaaaaa')

vi.mock('../users/user-model', async importOriginal => ({
  ...(await importOriginal<typeof import('../users/user-model')>()),
  findUserById: vi.fn(),
}))

/** Builds a lobby the invite endpoint can read seating and bans from. */
function makeLobby({
  seatedUserId,
  benchedUserId,
}: {
  seatedUserId?: SbUserId
  benchedUserId?: SbUserId
} = {}): Lobby {
  const host = createHuman(SENDER_ID)
  const bench: BenchedUser[] = benchedUserId
    ? [{ userId: benchedUserId, race: 'r', joinedAt: 0 }]
    : []
  return {
    id: LOBBY_ID,
    name: 'Test Lobby',
    mapQueue: [],
    gameType: GameType.Melee,
    gameSubType: 0,
    teams: [
      {
        name: 'Team 1',
        teamId: 1,
        isObserver: false,
        slots: seatedUserId ? [host, createHuman(seatedUserId)] : [host, createOpen()],
        hiddenSlots: [],
      },
    ],
    bench,
    host,
    useLegacyLimits: false,
    starcraftCompatibleReplays: false,
    lockedAlliances: false,
    visibility: 'listed',
    createdAt: 0,
  }
}

/** A fake `RouterContext` satisfying `inviteToLobby`'s param/body validation. */
function makeInviteCtx(): RouterContext {
  return {
    params: { lobbyId: LOBBY_ID },
    request: { body: { clientId: 'client-1', targetId: TARGET_ID } },
    session: { user: { id: SENDER_ID } },
  } as any
}

/**
 * Builds a `LobbyApi` with only the dependencies `inviteToLobby` touches mocked, so a test can
 * assert on both the HTTP error and whether a notification was actually written.
 */
function makeInviteApi({
  lobby = makeLobby(),
  existingInvites = [],
  senderBlockedByTarget = false,
  targetBlockedBySender = false,
}: {
  lobby?: Lobby
  existingInvites?: unknown[]
  senderBlockedByTarget?: boolean
  targetBlockedBySender?: boolean
} = {}) {
  const lobbyService = {
    getLobbyForClient: vi.fn().mockReturnValue(lobby),
    lobbyBannedUsers: new Map<SbLobbyId, Set<SbUserId>>(),
  }
  const notificationService = {
    retrieveNotifications: vi.fn().mockResolvedValue(existingInvites),
    addNotification: vi.fn().mockResolvedValue(undefined),
  }
  const userRelationshipService = {
    // Mirrors `isUserBlockedBy(userId, potentialBlocker)`: true when the *second* user has blocked
    // the first.
    isUserBlockedBy: vi.fn(
      async (userId: SbUserId, potentialBlocker: SbUserId) =>
        (potentialBlocker === TARGET_ID && userId === SENDER_ID && senderBlockedByTarget) ||
        (potentialBlocker === SENDER_ID && userId === TARGET_ID && targetBlockedBySender),
    ),
  }

  const api = new LobbyApi(
    lobbyService as any,
    { getById: vi.fn().mockReturnValue({ clientType: 'electron' }) } as any,
    notificationService as any,
    userRelationshipService as any,
  )

  return { api, notificationService }
}

describe('lobbies/lobby-api/LobbyApi#inviteToLobby', () => {
  test('rejects a target that is already seated in the lobby', async () => {
    const { api, notificationService } = makeInviteApi({
      lobby: makeLobby({ seatedUserId: TARGET_ID }),
    })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.AlreadyInLobby })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test('rejects a target that is on the lobby bench', async () => {
    const { api, notificationService } = makeInviteApi({
      lobby: makeLobby({ benchedUserId: TARGET_ID }),
    })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.AlreadyInLobby })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test('rejects a target that already has an outstanding invite', async () => {
    const { api, notificationService } = makeInviteApi({ existingInvites: [{ id: 1 }] })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.AlreadyInvited })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test('stores an invite notification for an eligible target', async () => {
    const { api, notificationService } = makeInviteApi()
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    await api.inviteToLobby(makeInviteCtx())

    expect(notificationService.retrieveNotifications).toHaveBeenCalledWith({
      userId: TARGET_ID,
      data: { type: NotificationType.LobbyInvite, lobbyId: LOBBY_ID },
      limit: 1,
    })
    expect(notificationService.addNotification).toHaveBeenCalledWith({
      userId: TARGET_ID,
      data: { type: NotificationType.LobbyInvite, from: SENDER_ID, lobbyId: LOBBY_ID },
    })
  })

  test.each([
    ['the sender blocked the target', { senderBlockedByTarget: true }],
    ['the target blocked the sender', { targetBlockedBySender: true }],
  ])('succeeds silently when %s', async (_description, blocks) => {
    const { api, notificationService } = makeInviteApi(blocks)
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    await expect(api.inviteToLobby(makeInviteCtx())).resolves.toBeUndefined()

    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })
})
