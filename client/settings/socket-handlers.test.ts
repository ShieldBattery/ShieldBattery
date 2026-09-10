import type { NydusClient } from 'nydus-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AccountSettingsUpdateEvent } from '../../common/settings/account-settings'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { registerDispatch } from '../dispatch-registry'
import registerModule from './socket-handlers'

const mocks = vi.hoisted(() => ({ writeCachedAccountSettings: vi.fn() }))
vi.mock('./account-settings-cache', () => ({
  writeCachedAccountSettings: mocks.writeCachedAccountSettings,
}))

const USER_ID = makeSbUserId(1)

beforeEach(() => vi.clearAllMocks())

describe('account settings updates', () => {
  test('dispatches the new settings and writes them to the cache', () => {
    const dispatched = vi.fn()
    registerDispatch(dispatched)

    const registerRoute = vi.fn()
    registerModule({ siteSocket: { registerRoute } as unknown as NydusClient })
    const [, receive] = registerRoute.mock.calls.find(
      ([path]) => path === '/account-settings/:userId',
    )!

    const event: AccountSettingsUpdateEvent = {
      action: 'update',
      settings: { quietChannelsWhileInGame: false, quietWhispersWhileInGame: true },
    }
    receive({ params: { userId: String(USER_ID) } }, event)

    expect(dispatched).toHaveBeenCalledExactlyOnceWith({
      type: '@settings/updateAccountSettings',
      payload: event.settings,
    })
    expect(mocks.writeCachedAccountSettings).toHaveBeenCalledExactlyOnceWith(
      USER_ID,
      event.settings,
    )
  })
})
