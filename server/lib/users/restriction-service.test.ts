import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NotificationType } from '../../../common/notifications'
import { asMockedFunction } from '../../../common/testing/mocks'
import { RestrictionKind, RestrictionReason } from '../../../common/users/restrictions'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import NotificationService from '../notifications/notification-service'
import { FakeClock } from '../time/testing/fake-clock'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { MIN_IDENTIFIER_MATCHES } from './client-ids'
import {
  countRestrictedUserIdentifiers,
  getActiveRestrictionsForUsers,
  getActiveUserRestrictions,
  liftIdentifierRestrictions,
  liftUserRestrictions,
  restrictAllIdentifiers,
  restrictUsers,
  UserRestriction,
} from './restriction-models'
import { RestrictionService } from './restriction-service'
import { findConnectedUsers } from './user-identifiers'

vi.mock('./client-ids', () => ({ MIN_IDENTIFIER_MATCHES: 4 }))

vi.mock('./restriction-models', () => ({
  checkMultipleRestrictions: vi.fn(),
  checkRestriction: vi.fn(),
  countRestrictedUserIdentifiers: vi.fn(),
  getActiveRestrictionsForUsers: vi.fn(),
  getActiveUserRestrictions: vi.fn(),
  liftIdentifierRestrictions: vi.fn(),
  liftUserRestrictions: vi.fn(),
  mirrorRestrictionsToIdentifiers: vi.fn(),
  restrictAllIdentifiers: vi.fn(),
  restrictUsers: vi.fn(),
  retrieveRestrictionHistory: vi.fn(),
}))

vi.mock('./user-identifiers', () => ({
  findConnectedUsers: vi.fn(),
}))

const dbClient = {}
vi.mock('../db/transaction', () => ({
  default: vi.fn(async next => {
    return await next(dbClient)
  }),
}))

const ADMIN = makeSbUserId(1)
const TARGET = makeSbUserId(2)
const CONNECTED = makeSbUserId(3)

const NOW = 1_700_000_000_000

function makeRestriction(overrides: Partial<UserRestriction> = {}): UserRestriction {
  return {
    id: 'restriction-id',
    userId: TARGET,
    kind: RestrictionKind.Chat,
    startTime: new Date(NOW - 60_000),
    endTime: new Date(NOW + 60 * 60 * 1000),
    restrictedBy: ADMIN,
    reason: RestrictionReason.Spam,
    ...overrides,
  }
}

describe('users/restriction-service', () => {
  let publish: ReturnType<typeof vi.fn>
  let addNotification: ReturnType<typeof vi.fn>
  let service: RestrictionService

  beforeEach(() => {
    vi.clearAllMocks()

    publish = vi.fn()
    addNotification = vi.fn().mockResolvedValue(undefined)
    const clock = new FakeClock()
    clock.setCurrentTime(NOW)

    service = new RestrictionService(
      { on: vi.fn() } as any as UserSocketsManager,
      { publish } as any as TypedPublisher<any>,
      clock,
      { addNotification } as any as NotificationService,
    )

    asMockedFunction(findConnectedUsers).mockResolvedValue([CONNECTED])
    asMockedFunction(getActiveRestrictionsForUsers).mockResolvedValue(new Map())
  })

  describe('liftRestriction', () => {
    test('lifts the kind on the target, its connected accounts, and their identifiers', async () => {
      const targetRestriction = makeRestriction()
      const connectedRestriction = makeRestriction({ id: 'connected-id', userId: CONNECTED })
      asMockedFunction(liftUserRestrictions).mockResolvedValue([
        targetRestriction,
        connectedRestriction,
      ])

      const result = await service.liftRestriction({
        targetId: TARGET,
        kind: RestrictionKind.Chat,
        liftedBy: ADMIN,
        reason: 'appealed',
      })

      expect(result).toEqual([targetRestriction, connectedRestriction])
      expect(liftUserRestrictions).toHaveBeenCalledWith(
        {
          users: [CONNECTED, TARGET],
          kind: RestrictionKind.Chat,
          liftedBy: ADMIN,
          reason: 'appealed',
          now: new Date(NOW),
        },
        dbClient,
      )
      expect(liftIdentifierRestrictions).toHaveBeenCalledWith(
        { users: [CONNECTED, TARGET], kind: RestrictionKind.Chat, now: new Date(NOW) },
        dbClient,
      )
    })

    test('publishes the remaining active restrictions to each lifted user', async () => {
      asMockedFunction(liftUserRestrictions).mockResolvedValue([
        makeRestriction(),
        makeRestriction({ id: 'second-id' }),
        makeRestriction({ id: 'connected-id', userId: CONNECTED }),
      ])
      const matchmaking = makeRestriction({
        id: 'mm-id',
        kind: RestrictionKind.Matchmaking,
        reason: undefined,
      })
      asMockedFunction(getActiveRestrictionsForUsers).mockResolvedValue(
        new Map([[TARGET, [matchmaking]]]),
      )

      await service.liftRestriction({ targetId: TARGET, kind: RestrictionKind.Chat })

      expect(getActiveRestrictionsForUsers).toHaveBeenCalledWith([TARGET, CONNECTED])
      expect(publish).toHaveBeenCalledTimes(2)
      expect(publish).toHaveBeenCalledWith('/restrictions/2', {
        type: 'restrictionsChanged',
        restrictions: [
          {
            kind: RestrictionKind.Matchmaking,
            endTime: Number(matchmaking.endTime),
            reason: undefined,
          },
        ],
      })
      expect(publish).toHaveBeenCalledWith('/restrictions/3', {
        type: 'restrictionsChanged',
        restrictions: [],
      })
      expect(addNotification).not.toHaveBeenCalled()
    })

    test("publishes nothing if the kind wasn't active", async () => {
      asMockedFunction(liftUserRestrictions).mockResolvedValue([])

      await service.liftRestriction({ targetId: TARGET, kind: RestrictionKind.Chat })

      expect(getActiveRestrictionsForUsers).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  })

  describe('handleNewIdentifiers', () => {
    const MATCHING_INFO = {
      latestEnd: new Date(NOW + 60 * 60 * 1000),
      reason: RestrictionReason.Spam,
      restrictedBy: ADMIN,
      firstUserId: CONNECTED,
    }

    beforeEach(() => {
      asMockedFunction(getActiveUserRestrictions).mockResolvedValue([])
      asMockedFunction(restrictUsers).mockResolvedValue([makeRestriction()])
      asMockedFunction(restrictAllIdentifiers).mockResolvedValue(undefined)
    })

    test('ignores restrictions matching fewer than the minimum number of identifiers', async () => {
      asMockedFunction(countRestrictedUserIdentifiers).mockImplementation(async ({ kind }) =>
        kind === RestrictionKind.Chat
          ? { ...MATCHING_INFO, count: MIN_IDENTIFIER_MATCHES - 1 }
          : undefined,
      )

      await service.handleNewIdentifiers(TARGET, [])

      expect(restrictUsers).not.toHaveBeenCalled()
      expect(restrictAllIdentifiers).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
      expect(addNotification).not.toHaveBeenCalled()
    })

    test('applies restrictions matching the minimum number of identifiers', async () => {
      asMockedFunction(countRestrictedUserIdentifiers).mockImplementation(async ({ kind }) =>
        kind === RestrictionKind.Chat
          ? { ...MATCHING_INFO, count: MIN_IDENTIFIER_MATCHES }
          : undefined,
      )

      await service.handleNewIdentifiers(TARGET, [])

      expect(restrictUsers).toHaveBeenCalledWith(
        {
          users: [TARGET],
          causedBy: CONNECTED,
          kind: RestrictionKind.Chat,
          startTime: new Date(NOW),
          endTime: MATCHING_INFO.latestEnd,
          restrictedBy: ADMIN,
          reason: RestrictionReason.Spam,
        },
        dbClient,
      )
      expect(restrictAllIdentifiers).toHaveBeenCalledTimes(1)
      expect(addNotification).toHaveBeenCalledTimes(1)
    })
  })

  describe('applyRestriction', () => {
    test('publishes the full set of active restrictions, not just the new one', async () => {
      const chat = makeRestriction()
      const matchmaking = makeRestriction({
        id: 'mm-id',
        kind: RestrictionKind.Matchmaking,
        reason: undefined,
      })
      asMockedFunction(restrictUsers).mockResolvedValue([chat])
      asMockedFunction(restrictAllIdentifiers).mockResolvedValue(undefined)
      asMockedFunction(getActiveRestrictionsForUsers).mockResolvedValue(
        new Map([[TARGET, [chat, matchmaking]]]),
      )

      await service.applyRestriction({
        targetId: TARGET,
        kind: RestrictionKind.Chat,
        endTime: chat.endTime,
        reason: RestrictionReason.Spam,
        restrictedBy: ADMIN,
      })

      expect(publish).toHaveBeenCalledWith('/restrictions/2', {
        type: 'restrictionsChanged',
        restrictions: [
          { kind: RestrictionKind.Chat, endTime: Number(chat.endTime), reason: chat.reason },
          {
            kind: RestrictionKind.Matchmaking,
            endTime: Number(matchmaking.endTime),
            reason: undefined,
          },
        ],
      })
      expect(addNotification).toHaveBeenCalledWith({
        userId: TARGET,
        data: {
          type: NotificationType.UserRestricted,
          kind: RestrictionKind.Chat,
          endTime: Number(chat.endTime),
          reason: chat.reason,
        },
      })
    })
  })
})
