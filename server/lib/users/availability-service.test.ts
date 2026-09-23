import { EventEmitter } from 'node:events'
import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AccountSettings,
  DEFAULT_ACCOUNT_SETTINGS,
} from '../../../common/settings/account-settings'
import { asMockedFunction } from '../../../common/testing/mocks'
import { UserAvailability } from '../../../common/users/availability'
import { RestrictionKind } from '../../../common/users/restrictions'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { getAccountSettings, updateAccountSettings } from '../settings/account-settings-model'
import { AccountSettingsService } from '../settings/account-settings-service'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { UserSocketsManager } from '../websockets/socket-groups'
import {
  createFakeNydusServer,
  FakeNydusServer,
  InspectableNydusClient,
  NydusConnector,
} from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { AvailabilityService, getAvailabilityPath } from './availability-service'
import { RestrictionService } from './restriction-service'

vi.mock('../settings/account-settings-model', () => ({
  getAccountSettings: vi.fn(),
  updateAccountSettings: vi.fn(),
}))

const USER = makeSbUserId(1)
const AWAY = { availability: UserAvailability.Away, statusMessage: 'brb' }
const DND = { availability: UserAvailability.DoNotDisturb, statusMessage: '' }

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
  let service: AvailabilityService

  beforeEach(() => {
    vi.clearAllMocks()
    asMockedFunction(getAccountSettings).mockResolvedValue(undefined)

    nydus = createFakeNydusServer()
    fakeNydus = nydus as unknown as FakeNydusServer
    const sessionLookup = new RequestSessionLookup()
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const publisher = new TypedPublisher(nydus)

    accountSettingsService = new AccountSettingsService(publisher, userSocketsManager)
    restrictionService = new FakeRestrictionService()
    service = new AvailabilityService(
      publisher,
      userSocketsManager,
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
})
