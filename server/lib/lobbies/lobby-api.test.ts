import Router, { RouterContext } from '@koa/router'
import got from 'got'
import http from 'http'
import Koa from 'koa'
import { AddressInfo } from 'net'
import { container } from 'tsyringe'
import { afterEach, beforeEach, describe, expect, Mock, test, vi } from 'vitest'
import { FilesErrorCode } from '../../../common/files'
import { GameType } from '../../../common/games/game-type'
import { BenchedUser, Lobby } from '../../../common/lobbies'
import { BEST_OF_LOGO_MAX_SIZE_BYTES } from '../../../common/lobbies/lobby-best-of'
import {
  InviteToLobbyErrorCode,
  LobbyJoinErrorCode,
  LobbyServiceErrorCode,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId, SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman, createOpen } from '../../../common/lobbies/slot'
import { NotificationType } from '../../../common/notifications'
import { AllowedInviteSource } from '../../../common/settings/account-settings'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { errorPayloadMiddleware } from '../errors/error-payload-middleware'
import { applyApiRoutes } from '../http/http-api'
import { Redis } from '../redis/redis'
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
  [LobbyServiceErrorCode.BestOfAlreadyRunning]: { status: 409 },
  [LobbyServiceErrorCode.BestOfGameNotPending]: { status: 409 },
  [LobbyServiceErrorCode.BestOfLogoInappropriate]: { status: 400 },
  [LobbyServiceErrorCode.BestOfLogoInvalidFormat]: { status: 400 },
  [LobbyServiceErrorCode.BestOfLogoTooLarge]: { status: 400 },
  [LobbyServiceErrorCode.BestOfLogoUnsupportedSvg]: { status: 400 },
  [LobbyServiceErrorCode.BestOfGamePending]: { status: 409 },
  [LobbyServiceErrorCode.BestOfRosterMismatch]: { status: 409 },
  [LobbyServiceErrorCode.ChatRestricted]: { status: 403 },
  [LobbyServiceErrorCode.ComputerInObserverSlot]: { status: 400 },
  [LobbyServiceErrorCode.CountingDown]: { status: 409 },
  [LobbyServiceErrorCode.ForcedRace]: { status: 403 },
  [LobbyServiceErrorCode.GameInProgress]: { status: 409 },
  [LobbyServiceErrorCode.InvalidBestOf]: { status: 400 },
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
  [LobbyServiceErrorCode.NoBestOfRunning]: { status: 409 },
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
  allowInvitesFrom = 'all',
  senderAndTargetAreFriends = false,
}: {
  lobby?: Lobby
  existingInvites?: unknown[]
  senderBlockedByTarget?: boolean
  targetBlockedBySender?: boolean
  allowInvitesFrom?: AllowedInviteSource
  senderAndTargetAreFriends?: boolean
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
    areFriends: vi.fn().mockResolvedValue(senderAndTargetAreFriends),
  }
  const accountSettingsService = {
    getSettings: vi.fn().mockResolvedValue({ allowInvitesFrom }),
  }

  const api = new LobbyApi(
    lobbyService as any,
    { getById: vi.fn().mockReturnValue({ clientType: 'electron' }) } as any,
    notificationService as any,
    userRelationshipService as any,
    accountSettingsService as any,
    {} as any,
  )

  return { api, lobbyService, notificationService, userRelationshipService }
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

  test('succeeds silently for a target that already has an outstanding invite', async () => {
    const { api, notificationService } = makeInviteApi({ existingInvites: [{ id: 1 }] })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    await expect(api.inviteToLobby(makeInviteCtx())).resolves.toBeUndefined()

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

  test.each([
    ['the sender blocked the target', { senderBlockedByTarget: true }],
    ['the target blocked the sender', { targetBlockedBySender: true }],
  ])('still rejects an already-seated target when %s', async (_description, blocks) => {
    const { api, notificationService } = makeInviteApi({
      ...blocks,
      lobby: makeLobby({ seatedUserId: TARGET_ID }),
    })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.AlreadyInLobby })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test.each([
    ['the sender blocked the target', { senderBlockedByTarget: true }],
    ['the target blocked the sender', { targetBlockedBySender: true }],
  ])('still rejects a target that accepts no invites when %s', async (_description, blocks) => {
    const { api, notificationService } = makeInviteApi({ ...blocks, allowInvitesFrom: 'none' })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.NotAcceptingInvites })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test('still rejects a banned target when a block exists', async () => {
    const { api, notificationService, lobbyService } = makeInviteApi({
      senderBlockedByTarget: true,
    })
    lobbyService.lobbyBannedUsers.set(LOBBY_ID, new Set([TARGET_ID]))
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.BannedFromLobby })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test('rejects an invite when the target accepts no invites', async () => {
    const { api, notificationService, userRelationshipService } = makeInviteApi({
      allowInvitesFrom: 'none',
    })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.NotAcceptingInvites })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
    // Whether the two are friends can't change the answer, so the lookup is skipped.
    expect(userRelationshipService.areFriends).not.toHaveBeenCalled()
  })

  test('rejects an invite when the target only accepts friends and the sender is not one', async () => {
    const { api, notificationService, userRelationshipService } = makeInviteApi({
      allowInvitesFrom: 'friends',
    })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    const err = await api.inviteToLobby(makeInviteCtx()).catch(e => e)

    expect(userRelationshipService.areFriends).toHaveBeenCalledWith(SENDER_ID, TARGET_ID)
    expect(err).toHaveProperty('status', 409)
    expect(err.payload).toEqual({ code: InviteToLobbyErrorCode.NotAcceptingInvites })
    expect(notificationService.addNotification).not.toHaveBeenCalled()
  })

  test('invites a friend of a target that only accepts invites from friends', async () => {
    const { api, notificationService, userRelationshipService } = makeInviteApi({
      allowInvitesFrom: 'friends',
      senderAndTargetAreFriends: true,
    })
    vi.mocked(findUserById).mockResolvedValue({ id: TARGET_ID, name: 'TargetUser' } as any)

    await api.inviteToLobby(makeInviteCtx())

    expect(userRelationshipService.areFriends).toHaveBeenCalledWith(SENDER_ID, TARGET_ID)
    expect(notificationService.addNotification).toHaveBeenCalledWith({
      userId: TARGET_ID,
      data: { type: NotificationType.LobbyInvite, from: SENDER_ID, lobbyId: LOBBY_ID },
    })
  })
})

describe('lobbies/lobby-api/LobbyApi best-of starts and saves', () => {
  let server: http.Server
  let baseUrl: string
  let overlayService: { startBestOf: Mock; updateBestOf: Mock }
  let throttleKeys: string[]

  beforeEach(async () => {
    throttleKeys = []
    container.register(Redis, {
      useValue: {
        client: {
          sbThrottle: vi.fn(async (key: string) => {
            throttleKeys.push(key)
            return [0, 0]
          }),
        },
      } as unknown as Redis,
    })
    overlayService = {
      startBestOf: vi.fn().mockResolvedValue({}),
      updateBestOf: vi.fn().mockResolvedValue({}),
    }
    const api = new LobbyApi(
      {} as any,
      { getById: vi.fn().mockReturnValue({ clientType: 'electron', userId: SENDER_ID }) } as any,
      {} as any,
      {} as any,
      {} as any,
      overlayService as any,
    )
    const router = new Router()
    applyApiRoutes(router, api)
    const app = new Koa()
    app.on('error', () => {})
    app
      .use(errorPayloadMiddleware())
      .use(async (ctx, next) => {
        ;(ctx as any).session = { user: { id: SENDER_ID } }
        await next()
      })
      .use(router.routes())
    const callback = app.callback()
    server = http.createServer((req, res) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      callback(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, resolve))
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/api/1/lobbies/${LOBBY_ID}`
  })

  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  function form(field: string, value: object, logo?: Blob) {
    const body = new FormData()
    body.append(field, JSON.stringify(value))
    if (logo) {
      body.append('logo', logo, 'brand.png')
    }
    return body
  }

  function post(route: string, body: FormData) {
    return got.post(`${baseUrl}/${route}`, {
      body,
      throwHttpErrors: false,
      retry: { limit: 0 },
      headers: { accept: 'application/json' },
    })
  }

  const series = { clientId: 'client-1', length: 3, sides: [[2], [3]] }

  test('starts one from the multipart fields, with the logo file and its own throttle', async () => {
    const response = await post(
      'start-best-of',
      form(
        'series',
        { ...series, title: ' Final ', line1: '  Casters  ', line2: '' },
        new Blob([Buffer.from('logo bytes')]),
      ),
    )

    expect(response.statusCode).toBe(204)
    expect(overlayService.startBestOf).toHaveBeenCalledWith(
      expect.objectContaining({
        lobbyId: LOBBY_ID,
        length: 3,
        title: 'Final',
        sides: [[2], [3]],
        line1: 'Casters',
        line2: '',
      }),
      {
        kind: 'replace',
        file: expect.objectContaining({
          filepath: expect.any(String),
          originalFilename: 'brand.png',
        }),
      },
    )
    expect(throttleKeys).toEqual([`sbthrottle:lobbies/best-of-logo~${SENDER_ID}`])
  })

  test('starts one without a file, keeping or removing the remembered logo', async () => {
    await post('start-best-of', form('series', series))
    await post('start-best-of', form('series', { ...series, deleteLogo: true }))

    expect(overlayService.startBestOf.mock.calls.map(([, change]) => change)).toEqual([
      { kind: 'keep' },
      { kind: 'remove' },
    ])
    expect(throttleKeys).toEqual([
      `sbthrottle:lobbies/action~${SENDER_ID}`,
      `sbthrottle:lobbies/action~${SENDER_ID}`,
    ])
  })

  test('refuses a logo over 2 MB with a 413', async () => {
    const response = await post(
      'start-best-of',
      form('series', series, new Blob([Buffer.alloc(BEST_OF_LOGO_MAX_SIZE_BYTES + 1)])),
    )

    expect(response.statusCode).toBe(413)
    expect(JSON.parse(response.body)).toEqual({ code: FilesErrorCode.MaxFileSizeExceeded })
    expect(overlayService.startBestOf).not.toHaveBeenCalled()
  })

  test('refuses lines over the limit, and a logo both uploaded and removed', async () => {
    const tooLong = await post(
      'start-best-of',
      form('series', { ...series, line2: 'x'.repeat(61) }),
    )
    const both = await post(
      'start-best-of',
      form('series', { ...series, deleteLogo: true }, new Blob([Buffer.from('logo')])),
    )

    expect(tooLong.statusCode).toBe(400)
    expect(both.statusCode).toBe(400)
    expect(overlayService.startBestOf).not.toHaveBeenCalled()
  })

  test('saves a change of lines, or of the logo alone, and refuses one that changes nothing', async () => {
    const lines = await post(
      'update-best-of',
      form('changes', { clientId: 'client-1', line1: null, line2: ' Observer ' }),
    )
    const logoOnly = await post(
      'update-best-of',
      form('changes', { clientId: 'client-1' }, new Blob([Buffer.from('logo')])),
    )
    const nothing = await post('update-best-of', form('changes', { clientId: 'client-1' }))

    expect(lines.statusCode).toBe(204)
    expect(logoOnly.statusCode).toBe(204)
    expect(nothing.statusCode).toBe(400)
    expect(overlayService.updateBestOf.mock.calls).toEqual([
      [expect.objectContaining({ line1: null, line2: 'Observer' }), { kind: 'keep' }],
      [expect.objectContaining({ line1: undefined }), expect.objectContaining({ kind: 'replace' })],
    ])
  })

  test("answers a refused logo with the service's code", async () => {
    overlayService.startBestOf.mockRejectedValue(
      new LobbyServiceError(LobbyServiceErrorCode.BestOfLogoInappropriate, 'inappropriate'),
    )

    const response = await post(
      'start-best-of',
      form('series', series, new Blob([Buffer.from('logo')])),
    )

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toEqual({
      code: LobbyServiceErrorCode.BestOfLogoInappropriate,
    })
  })
})

describe('lobbies/lobby-api/LobbyApi#joinLobby', () => {
  test('still succeeds when clearing the invite notification fails', async () => {
    const lobbyService = {
      getUserById: vi.fn().mockReturnValue({}),
      joinLobby: vi.fn().mockResolvedValue(undefined),
    }
    const notificationService = {
      clearFirstMatching: vi.fn().mockRejectedValue(new Error('db down')),
    }
    const api = new LobbyApi(
      lobbyService as any,
      { getById: vi.fn().mockReturnValue({ clientType: 'electron' }) } as any,
      notificationService as any,
      {} as any,
      {} as any,
      {} as any,
    )

    const ctx = {
      params: { lobbyId: LOBBY_ID },
      request: { body: { clientId: 'client-1' } },
      session: { user: { id: SENDER_ID } },
    } as any

    await expect(api.joinLobby(ctx)).resolves.toBeUndefined()

    expect(lobbyService.joinLobby).toHaveBeenCalled()
    expect(notificationService.clearFirstMatching).toHaveBeenCalledWith({
      userId: SENDER_ID,
      data: { type: NotificationType.LobbyInvite, lobbyId: LOBBY_ID },
    })
  })
})
