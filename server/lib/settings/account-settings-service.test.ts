import { NydusServer } from 'nydus'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_ACCOUNT_SETTINGS } from '../../../common/settings/account-settings'
import { asMockedFunction } from '../../../common/testing/mocks'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { RequestSessionLookup } from '../websockets/session-lookup'
import { UserSocketsManager } from '../websockets/socket-groups'
import { createFakeNydusServer, NydusConnector } from '../websockets/testing/websockets'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getAccountSettings, updateAccountSettings } from './account-settings-model'
import { AccountSettingsService, getAccountSettingsPath } from './account-settings-service'

const { user1 } = vi.hoisted(() => ({
  user1: { id: 1 as SbUserId, name: 'USER_NAME_1', created: 1577836800000 } as SbUser,
}))

vi.mock('./account-settings-model', () => ({
  getAccountSettings: vi.fn(),
  updateAccountSettings: vi.fn(),
}))

describe('settings/account-settings-service', () => {
  let nydus: NydusServer
  let service: AccountSettingsService
  let connector: NydusConnector

  beforeEach(() => {
    nydus = createFakeNydusServer()
    const sessionLookup = new RequestSessionLookup()
    const userSocketsManager = new UserSocketsManager(nydus, sessionLookup, async () => {})
    const publisher = new TypedPublisher(nydus)

    service = new AccountSettingsService(publisher, userSocketsManager)
    connector = new NydusConnector(nydus, sessionLookup)
  })

  describe('on connect', () => {
    test('subscribes the user and sends stored settings merged over defaults', async () => {
      asMockedFunction(getAccountSettings).mockResolvedValue({ quietWhileInGame: false })

      const client = connector.connectClient(user1, 'USER1_CLIENT_ID')
      // The initial data getter is async, so its publish lands on a later tick.
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(client.publish).toHaveBeenCalledWith(getAccountSettingsPath(user1.id), {
        action: 'update',
        settings: { quietWhileInGame: false },
      })
    })

    test('sends the defaults for a user with no stored row', async () => {
      asMockedFunction(getAccountSettings).mockResolvedValue(undefined)

      const client = connector.connectClient(user1, 'USER1_CLIENT_ID')
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(client.publish).toHaveBeenCalledWith(getAccountSettingsPath(user1.id), {
        action: 'update',
        settings: DEFAULT_ACCOUNT_SETTINGS,
      })
    })

    test('sends nothing on that path and does not throw when the model rejects', async () => {
      asMockedFunction(getAccountSettings).mockRejectedValue(new Error('db exploded'))

      const client = connector.connectClient(user1, 'USER1_CLIENT_ID')
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(client.publish).not.toHaveBeenCalledWith(
        getAccountSettingsPath(user1.id),
        expect.anything(),
      )
    })
  })

  describe('updateSettings', () => {
    test('stores the patch, publishes the filled-in settings, and returns them', async () => {
      asMockedFunction(updateAccountSettings).mockResolvedValue({ quietWhileInGame: false })

      const result = await service.updateSettings(user1.id, { quietWhileInGame: false })

      expect(updateAccountSettings).toHaveBeenCalledWith(user1.id, { quietWhileInGame: false })
      expect(result).toEqual({ quietWhileInGame: false })
      expect(nydus.publish).toHaveBeenCalledWith(getAccountSettingsPath(user1.id), {
        action: 'update',
        settings: { quietWhileInGame: false },
      })
    })
  })
})
