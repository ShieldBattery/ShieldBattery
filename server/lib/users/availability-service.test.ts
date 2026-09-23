import { EventEmitter } from 'node:events'
import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AccountSettings,
  DEFAULT_ACCOUNT_SETTINGS,
} from '../../../common/settings/account-settings'
import { asMockedFunction } from '../../../common/testing/mocks'
import { UserAvailability } from '../../../common/users/availability'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { RestrictionKind } from '../../../common/users/restrictions'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getAccountSettings, updateAccountSettings } from '../settings/account-settings-model'
import { AccountSettingsService } from '../settings/account-settings-service'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { ClientSocketsManager, UserSocketsManager } from '../websockets/socket-groups'
import {
  createFakeNydusServer,
  FakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { ActivityStatusService } from './activity-status-service'
import { AvailabilityService, getAvailabilityPath } from './availability-service'
import { RestrictionService } from './restriction-service'
import { FakeActivityStatusService } from './testing/activity-status-service'

vi.mock('../settings/account-settings-model', () => ({
  getAccountSettings: vi.fn(),
  updateAccountSettings: vi.fn(),
}))

const USER = makeSbUserId(1)
const AWAY = { availability: UserAvailability.Away, statusMessage: 'brb' }
const DND = { availability: UserAvailability.DoNotDisturb, statusMessage: '' }
const ONLINE = { availability: UserAvailability.Online, statusMessage: '' }
const AUTO_AWAY = { availability: UserAvailability.Away, statusMessage: '' }

class FakeRestrictionService extends EventEmitter {
  isRestricted = vi.fn().mockResolvedValue(false)
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('users/availability-service', () => {
  let nydus: NydusServer
  let fakeNydus: FakeNydusServer
  let connector: NydusConnector
  let accountSettingsService: AccountSettingsService
  let restrictionService: FakeRestrictionService
  let activityStatusService: FakeActivityStatusService
  let service: AvailabilityService

  beforeEach(() => {
    vi.clearAllMocks()
    asMockedFunction(getAccountSettings).mockResolvedValue(undefined)

    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    const clientSocketsManager = new ClientSocketsManager(nydus, sessionLookup)
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const publisher = new TypedPublisher(nydus)

    accountSettingsService = new AccountSettingsService(publisher, userSocketsManager)
    restrictionService = new FakeRestrictionService()
    activityStatusService = new FakeActivityStatusService()
    service = new AvailabilityService(
      publisher,
      userSocketsManager,
      clientSocketsManager,
      activityStatusService as any as ActivityStatusService,
      accountSettingsService,
      restrictionService as any as RestrictionService,
    )
    connector = new NydusConnector(nydus, sessionLookup)
  })

  function connect(clientId = 'one'): InspectableNydusClient {
    return connector.connectClient({ id: USER, name: 'user', created: 0 }, clientId)
  }

  test('has no availability for a user with no sockets', () => {
    expect(service.get(USER)).toBeUndefined()
  })

  test('publishes the stored availability once it loads on first connect', async () => {
    asMockedFunction(getAccountSettings).mockResolvedValue(AWAY)
    const onChange = vi.fn()
    service.on('change', onChange)

    connect()
    await flushPromises()

    expect(service.get(USER)).toEqual(AWAY)
    expect(fakeNydus.publish).toHaveBeenCalledWith(getAvailabilityPath(USER), {
      userId: USER,
      info: AWAY,
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(USER, AWAY, undefined)
  })

  test('loads the default for a user with nothing stored', async () => {
    connect()
    await flushPromises()

    expect(service.get(USER)).toEqual({
      availability: UserAvailability.Online,
      statusMessage: '',
    })
  })

  test('publishes a change made while online', async () => {
    connect()
    await flushPromises()
    const onChange = vi.fn()
    service.on('change', onChange)
    asMockedFunction(updateAccountSettings).mockResolvedValue(DND)

    await accountSettingsService.updateSettings(USER, DND)

    expect(service.get(USER)).toEqual(DND)
    expect(fakeNydus.publish).toHaveBeenCalledWith(getAvailabilityPath(USER), {
      userId: USER,
      info: DND,
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(USER, DND, {
      availability: UserAvailability.Online,
      statusMessage: '',
    })
  })

  test("doesn't publish a settings change that leaves availability as it was", async () => {
    connect()
    await flushPromises()
    const onChange = vi.fn()
    service.on('change', onChange)
    asMockedFunction(updateAccountSettings).mockResolvedValue({ quietChannelsWhileInGame: false })

    await accountSettingsService.updateSettings(USER, { quietChannelsWhileInGame: false })

    expect(onChange).not.toHaveBeenCalled()
  })

  test('ignores a change made while offline', async () => {
    const onChange = vi.fn()
    service.on('change', onChange)
    asMockedFunction(updateAccountSettings).mockResolvedValue(DND)

    await accountSettingsService.updateSettings(USER, DND)

    expect(service.get(USER)).toBeUndefined()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('keeps a change made while the stored availability was still loading', async () => {
    let resolveLoad!: (value: Partial<AccountSettings>) => void
    asMockedFunction(getAccountSettings).mockReturnValue(
      new Promise(resolve => {
        resolveLoad = resolve
      }),
    )
    connect()
    asMockedFunction(updateAccountSettings).mockResolvedValue(DND)
    await accountSettingsService.updateSettings(USER, DND)

    resolveLoad(AWAY)
    await flushPromises()

    expect(service.get(USER)).toEqual(DND)
  })

  test('reports offline and forgets the availability when the last socket disconnects', async () => {
    asMockedFunction(getAccountSettings).mockResolvedValue(AWAY)
    const client = connect()
    await flushPromises()

    client.disconnect()

    expect(service.get(USER)).toBeUndefined()
    expect(fakeNydus.publish).toHaveBeenCalledWith(getAvailabilityPath(USER), {
      userId: USER,
      info: null,
    })
  })

  test('discards a load that finishes after the user disconnected', async () => {
    let resolveLoad!: (value: Partial<AccountSettings>) => void
    asMockedFunction(getAccountSettings).mockReturnValue(
      new Promise(resolve => {
        resolveLoad = resolve
      }),
    )
    const client = connect()
    client.disconnect()

    resolveLoad({ ...DEFAULT_ACCOUNT_SETTINGS, ...AWAY })
    await flushPromises()

    expect(service.get(USER)).toBeUndefined()
  })

  test("withholds a chat-restricted user's status message", async () => {
    asMockedFunction(getAccountSettings).mockResolvedValue(AWAY)
    restrictionService.isRestricted.mockResolvedValue(true)

    connect()
    await flushPromises()

    expect(restrictionService.isRestricted).toHaveBeenCalledWith(USER, RestrictionKind.Chat)
    expect(service.get(USER)).toEqual({ ...AWAY, statusMessage: '' })
  })

  test('withholds the status message once a chat restriction is applied', async () => {
    asMockedFunction(getAccountSettings).mockResolvedValue(AWAY)
    connect()
    await flushPromises()
    const onChange = vi.fn()
    service.on('change', onChange)

    restrictionService.emit('restrictionApplied', USER, RestrictionKind.Chat)

    const withheld = { ...AWAY, statusMessage: '' }
    expect(service.get(USER)).toEqual(withheld)
    expect(fakeNydus.publish).toHaveBeenCalledWith(getAvailabilityPath(USER), {
      userId: USER,
      info: withheld,
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(USER, withheld, AWAY)
  })

  test('keeps the status message when a different restriction is applied', async () => {
    asMockedFunction(getAccountSettings).mockResolvedValue(AWAY)
    connect()
    await flushPromises()

    restrictionService.emit('restrictionApplied', USER, RestrictionKind.AvatarUpload)

    expect(service.get(USER)).toEqual(AWAY)
  })

  test('withholds a status message set while the chat restriction was still loading', async () => {
    let resolveRestricted!: (value: boolean) => void
    restrictionService.isRestricted.mockReturnValue(
      new Promise(resolve => {
        resolveRestricted = resolve
      }),
    )
    connect()
    asMockedFunction(updateAccountSettings).mockResolvedValue(AWAY)
    await accountSettingsService.updateSettings(USER, AWAY)

    resolveRestricted(true)
    await flushPromises()

    expect(service.get(USER)).toEqual({ ...AWAY, statusMessage: '' })
  })

  test("subscribes the user's own sessions to their published availability", async () => {
    const client = connect()
    await flushPromises()

    expect(fakeNydus.subscribeClient).toHaveBeenCalledWith(
      expect.anything(),
      getAvailabilityPath(USER),
      expect.anything(),
    )
    expect(client.publish).toHaveBeenCalledWith(getAvailabilityPath(USER), {
      userId: USER,
      info: ONLINE,
    })
  })

  describe('idle clients', () => {
    test('shows an Online user as Away when their only client is idle', async () => {
      connect('one')
      await flushPromises()
      const onChange = vi.fn()
      service.on('change', onChange)

      service.setClientIdle(USER, 'one', true)

      expect(service.get(USER)).toEqual(AUTO_AWAY)
      expect(fakeNydus.publish).toHaveBeenCalledWith(getAvailabilityPath(USER), {
        userId: USER,
        info: AUTO_AWAY,
      })
      expect(onChange).toHaveBeenCalledExactlyOnceWith(USER, AUTO_AWAY, ONLINE)
      expect(updateAccountSettings).not.toHaveBeenCalled()
    })

    test('shows the user as Online again once the client is active', async () => {
      connect('one')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)

      service.setClientIdle(USER, 'one', false)

      expect(service.get(USER)).toEqual(ONLINE)
    })

    test('keeps the status message while showing the user as Away', async () => {
      asMockedFunction(getAccountSettings).mockResolvedValue({ statusMessage: 'hi' })
      connect('one')
      await flushPromises()

      service.setClientIdle(USER, 'one', true)

      expect(service.get(USER)).toEqual({
        availability: UserAvailability.Away,
        statusMessage: 'hi',
      })
    })

    test('stays Online while any other client is active', async () => {
      connect('one')
      connect('two')
      await flushPromises()

      service.setClientIdle(USER, 'one', true)

      expect(service.get(USER)).toEqual(ONLINE)
    })

    test('becomes Away once every client is idle', async () => {
      connect('one')
      connect('two')
      await flushPromises()

      service.setClientIdle(USER, 'one', true)
      service.setClientIdle(USER, 'two', true)

      expect(service.get(USER)).toEqual(AUTO_AWAY)
    })

    test('treats a newly connected client as active', async () => {
      connect('one')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)

      connect('two')

      expect(service.get(USER)).toEqual(ONLINE)
    })

    test('becomes Away when the only active client disconnects', async () => {
      connect('one')
      const active = connect('two')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)

      active.disconnect()

      expect(service.get(USER)).toEqual(AUTO_AWAY)
    })

    test('stops counting a disconnected idle client', async () => {
      const idle = connect('one')
      connect('two')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)
      idle.disconnect()

      expect(service.get(USER)).toEqual(ONLINE)

      // It counts as active again once it reconnects, until it reports otherwise.
      connect('one')
      service.setClientIdle(USER, 'two', true)
      expect(service.get(USER)).toEqual(ONLINE)
    })

    test('ignores reports from a client that is not connected', async () => {
      const client = connect('one')
      connect('two')
      await flushPromises()
      client.disconnect()

      service.setClientIdle(USER, 'one', true)
      service.setClientIdle(USER, 'two', true)

      expect(service.get(USER)).toEqual(AUTO_AWAY)

      service.setClientIdle(USER, 'unknown', false)
      expect(service.get(USER)).toEqual(AUTO_AWAY)
    })

    test('publishes only offline when the last idle client disconnects', async () => {
      const client = connect('one')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)
      fakeNydus.publish.mockClear()

      client.disconnect()

      expect(service.get(USER)).toBeUndefined()
      expect(fakeNydus.publish).toHaveBeenCalledExactlyOnceWith(getAvailabilityPath(USER), {
        userId: USER,
        info: null,
      })
    })

    test('starts out active after the user reconnects', async () => {
      const client = connect('one')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)
      client.disconnect()

      connect('one')
      await flushPromises()

      expect(service.get(USER)).toEqual(ONLINE)
    })

    test("doesn't publish when the shown availability doesn't change", async () => {
      connect('one')
      connect('two')
      await flushPromises()
      const onChange = vi.fn()
      service.on('change', onChange)
      fakeNydus.publish.mockClear()

      service.setClientIdle(USER, 'one', true)
      service.setClientIdle(USER, 'one', true)
      service.setClientIdle(USER, 'two', false)

      expect(onChange).not.toHaveBeenCalled()
      expect(fakeNydus.publish).not.toHaveBeenCalled()
    })

    test.each([
      ['Away', AWAY],
      ['Do not disturb', DND],
    ])('shows a chosen %s as it was chosen', async (_, chosen) => {
      asMockedFunction(getAccountSettings).mockResolvedValue(chosen)
      connect('one')
      await flushPromises()
      const onChange = vi.fn()
      service.on('change', onChange)

      service.setClientIdle(USER, 'one', true)
      expect(service.get(USER)).toEqual(chosen)
      service.setClientIdle(USER, 'one', false)
      expect(service.get(USER)).toEqual(chosen)

      expect(onChange).not.toHaveBeenCalled()
    })

    test('switches to the chosen availability, and back to Away when choosing Online', async () => {
      connect('one')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)

      asMockedFunction(updateAccountSettings).mockResolvedValue(DND)
      await accountSettingsService.updateSettings(USER, DND)
      expect(service.get(USER)).toEqual(DND)

      asMockedFunction(updateAccountSettings).mockResolvedValue(ONLINE)
      await accountSettingsService.updateSettings(USER, ONLINE)
      expect(service.get(USER)).toEqual(AUTO_AWAY)
    })

    test('shows an idle user as Online while they are in a game', async () => {
      connect('one')
      await flushPromises()
      service.setClientIdle(USER, 'one', true)
      expect(service.get(USER)).toEqual(AUTO_AWAY)

      activityStatusService.getStatus.mockReturnValue(FriendActivityStatus.InGame)
      activityStatusService.emit('change', USER, FriendActivityStatus.InGame)
      expect(service.get(USER)).toEqual(ONLINE)

      // Idle reports during the game don't change anything
      service.setClientIdle(USER, 'one', false)
      service.setClientIdle(USER, 'one', true)
      expect(service.get(USER)).toEqual(ONLINE)

      activityStatusService.getStatus.mockReturnValue(FriendActivityStatus.Online)
      activityStatusService.emit('change', USER, FriendActivityStatus.Online)
      expect(service.get(USER)).toEqual(AUTO_AWAY)
    })
  })
})
