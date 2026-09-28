import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ADMIN_REPORT_COUNT_MAX,
  ADMIN_REPORT_COUNT_WINDOW_MS,
  AdminReportCountsEvent,
  adminReportCountsPath,
} from '../../../common/admin-report-counts'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbPermissions } from '../../../common/users/permissions'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { listRecentUnresolvedBugReportTimes } from '../bugs/bugs-model'
import { listRecentUnresolvedGameReportTimes } from '../games/game-reports-models'
import { getPermissions } from '../models/permissions'
import { RedisSubscriber } from '../redis/redis'
import { FakeClock } from '../time/testing/fake-clock'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { UserSocketsManager } from '../websockets/socket-groups'
import {
  clearTestLogs,
  createFakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { AdminReportCountsService } from './admin-report-counts-service'

vi.mock('../bugs/bugs-model', () => ({
  listRecentUnresolvedBugReportTimes: vi.fn(),
}))
vi.mock('../games/game-reports-models', () => ({
  listRecentUnresolvedGameReportTimes: vi.fn(),
}))
vi.mock('../models/permissions', () => ({
  getPermissions: vi.fn(),
}))

const bugTimesMock = asMockedFunction(listRecentUnresolvedBugReportTimes)
const gameTimesMock = asMockedFunction(listRecentUnresolvedGameReportTimes)
const getPermissionsMock = asMockedFunction(getPermissions)

class FakeRedisSubscriber {
  private handlers = new Map<string, Array<(message: any) => void>>()

  subscribe = vi.fn(async (channel: string, handler: (message: any) => void) => {
    const existing = this.handlers.get(channel) ?? []
    existing.push(handler)
    this.handlers.set(channel, existing)
  })

  emit(channel: string, message: any) {
    for (const handler of this.handlers.get(channel) ?? []) {
      handler(message)
    }
  }
}

const BASE_TIME = Number(new Date('2026-01-01T00:00:00.000Z'))
const BUG_PATH = adminReportCountsPath('bugReports')
const GAME_PATH = adminReportCountsPath('gameReports')

function perms(overrides: Partial<SbPermissions>): SbPermissions {
  return {
    editPermissions: false,
    debug: false,
    banUsers: false,
    manageLeagues: false,
    manageMaps: false,
    manageMapPools: false,
    manageMatchmaking: false,
    manageMatchmakingSeasons: false,
    manageMatchmakingTimes: false,
    massDeleteMaps: false,
    moderateChatChannels: false,
    manageNews: false,
    manageBugReports: false,
    manageGameReports: false,
    manageRestrictedNames: false,
    manageSignupCodes: false,
    manageLiveStreams: false,
    ...overrides,
  }
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve))
  }
}

describe('admin/admin-report-counts-service', () => {
  let clock: FakeClock
  let nydus: NydusServer
  let connector: NydusConnector
  let redisSubscriber: FakeRedisSubscriber
  let service: AdminReportCountsService

  function connect(id: number, permissions: SbPermissions | undefined): InspectableNydusClient {
    getPermissionsMock.mockResolvedValueOnce(permissions)
    return connector.connectClient(
      { id: makeSbUserId(id), name: `User${id}`, created: 1577836800000 },
      `client${id}`,
    )
  }

  beforeEach(() => {
    clock = new FakeClock()
    clock.setCurrentTime(BASE_TIME)

    bugTimesMock.mockReset().mockResolvedValue([new Date(BASE_TIME - 1000)])
    gameTimesMock.mockReset().mockResolvedValue([new Date(BASE_TIME - 2000)])
    getPermissionsMock.mockReset()

    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    redisSubscriber = new FakeRedisSubscriber()

    service = new AdminReportCountsService(
      clock,
      new TypedPublisher<AdminReportCountsEvent>(nydus),
      userSocketsManager,
      redisSubscriber as unknown as RedisSubscriber,
    )

    connector = new NydusConnector(nydus, sessionLookup)
    clearTestLogs(nydus)
  })

  test('queries only reports within the window, capped', async () => {
    connect(1, perms({ manageBugReports: true }))
    await flush()

    expect(bugTimesMock).toHaveBeenCalledWith({
      since: new Date(BASE_TIME - ADMIN_REPORT_COUNT_WINDOW_MS),
      limit: ADMIN_REPORT_COUNT_MAX,
    })
  })

  test('subscribes users only to the kinds they have permission for', async () => {
    const bugAdmin = connect(1, perms({ manageBugReports: true }))
    const gameAdmin = connect(2, perms({ manageGameReports: true }))
    const nobody = connect(3, perms({ manageNews: true }))
    await flush()

    expect(bugAdmin.publish).toHaveBeenCalledWith(BUG_PATH, {
      kind: 'bugReports',
      createdAt: [BASE_TIME - 1000],
    })
    expect(bugAdmin.publish).not.toHaveBeenCalledWith(GAME_PATH, expect.anything())

    expect(gameAdmin.publish).toHaveBeenCalledWith(GAME_PATH, {
      kind: 'gameReports',
      createdAt: [BASE_TIME - 2000],
    })
    expect(gameAdmin.publish).not.toHaveBeenCalledWith(BUG_PATH, expect.anything())

    expect(nobody.publish).not.toHaveBeenCalledWith(BUG_PATH, expect.anything())
    expect(nobody.publish).not.toHaveBeenCalledWith(GAME_PATH, expect.anything())
  })

  test('publishes game report counts when a report is created or resolved', async () => {
    const admin = connect(1, perms({ manageGameReports: true }))
    await flush()
    asMockedFunction(admin.publish).mockClear()

    gameTimesMock.mockResolvedValue([])
    redisSubscriber.emit('gameReport', { type: 'reportResolved', data: { reportId: 'r1' } })
    await flush()

    expect(admin.publish).toHaveBeenCalledWith(GAME_PATH, { kind: 'gameReports', createdAt: [] })
  })

  test('collapses refreshes requested while one is running into one follow-up', async () => {
    connect(1, perms({ manageBugReports: true }))
    await flush()
    bugTimesMock.mockClear()

    service.refresh('bugReports')
    service.refresh('bugReports')
    service.refresh('bugReports')
    service.refresh('bugReports')
    await flush()

    expect(bugTimesMock).toHaveBeenCalledTimes(2)
  })

  test('follows permission changes for connected users', async () => {
    const admin = connect(1, perms({}))
    await flush()
    expect(admin.publish).not.toHaveBeenCalledWith(BUG_PATH, expect.anything())

    redisSubscriber.emit('user', {
      type: 'permissionsChanged',
      data: { userId: makeSbUserId(1), permissions: perms({ manageBugReports: true }) },
    })
    await flush()
    expect(admin.publish).toHaveBeenCalledWith(BUG_PATH, expect.anything())

    redisSubscriber.emit('user', {
      type: 'permissionsChanged',
      data: { userId: makeSbUserId(1), permissions: perms({}) },
    })
    await flush()
    asMockedFunction(admin.publish).mockClear()

    service.refresh('bugReports')
    await flush()
    expect(admin.publish).not.toHaveBeenCalledWith(BUG_PATH, expect.anything())
  })
})
