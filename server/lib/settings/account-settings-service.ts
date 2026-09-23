import { EventEmitter } from 'node:events'
import { singleton } from 'tsyringe'
import {
  AccountSettings,
  AccountSettingsEvent,
  fillAccountSettingsDefaults,
} from '../../../common/settings/account-settings'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import { UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { getAccountSettings, updateAccountSettings } from './account-settings-model'

export function getAccountSettingsPath(userId: SbUserId): string {
  return urlPath`/account-settings/${userId}`
}

type AccountSettingsServiceEvents = {
  /** A user's settings were changed; `settings` is their complete settings after the change. */
  change: [userId: SbUserId, settings: AccountSettings]
}

@singleton()
export class AccountSettingsService extends EventEmitter<AccountSettingsServiceEvents> {
  constructor(
    private publisher: TypedPublisher<AccountSettingsEvent>,
    private userSocketsManager: UserSocketsManager,
  ) {
    super()

    userSocketsManager.on('newUser', userSockets => {
      userSockets.subscribe<AccountSettingsEvent>(
        getAccountSettingsPath(userSockets.userId),
        async () => {
          try {
            return { action: 'update', settings: await this.getSettings(userSockets.userId) }
          } catch (err) {
            logger.error({ err }, 'error loading account settings')
            // Sending nothing leaves this session on its last-synced copy, whereas sending
            // defaults would overwrite it.
            return undefined
          }
        },
      )
    })
  }

  async getSettings(userId: SbUserId): Promise<AccountSettings> {
    return fillAccountSettingsDefaults(await getAccountSettings(userId))
  }

  async updateSettings(
    userId: SbUserId,
    patch: Partial<AccountSettings>,
  ): Promise<AccountSettings> {
    const stored = await updateAccountSettings(userId, patch)
    const settings = fillAccountSettingsDefaults(stored)
    // Reaches every socket the user has open, including the one that made the change.
    this.publisher.publish(getAccountSettingsPath(userId), { action: 'update', settings })
    this.emit('change', userId, settings)
    return settings
  }
}
