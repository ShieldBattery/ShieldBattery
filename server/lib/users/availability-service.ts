import { EventEmitter } from 'node:events'
import { singleton } from 'tsyringe'
import { AccountSettings } from '../../../common/settings/account-settings'
import { urlPath } from '../../../common/urls'
import { AvailabilityInfo, AvailabilityUpdateEvent } from '../../../common/users/availability'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import { AccountSettingsService } from '../settings/account-settings-service'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

export function getAvailabilityPath(userId: SbUserId): string {
  return urlPath`/availability/${userId}`
}

type AvailabilityServiceEvents = {
  /**
   * An online user's availability became known or changed. `prev` is `undefined` when the user has
   * just come online and their stored availability finished loading.
   */
  change: [userId: SbUserId, info: AvailabilityInfo, prev: AvailabilityInfo | undefined]
}

/**
 * Tracks the availability of every online user (what they've said about how available they are,
 * stored in their account settings) and publishes it to their friends. Other audiences (chat
 * channels) listen to `change` and deliver it over their own paths.
 *
 * A user counts as online here for exactly as long as `UserSocketsManager` has sockets for them, the
 * same condition `ActivityStatusService` uses, so the two never disagree about whether a user is
 * offline.
 */
@singleton()
export class AvailabilityService extends EventEmitter<AvailabilityServiceEvents> {
  /** Online users whose stored availability has loaded. */
  private byUser = new Map<SbUserId, AvailabilityInfo>()

  constructor(
    private publisher: TypedPublisher<AvailabilityUpdateEvent>,
    private userSocketsManager: UserSocketsManager,
    accountSettingsService: AccountSettingsService,
  ) {
    super()

    userSocketsManager
      .on('newUser', userSockets => {
        this.loadStored(userSockets, accountSettingsService).catch(err => {
          logger.error({ err }, 'error loading availability for new user')
        })
      })
      .on('userQuit', userId => {
        this.byUser.delete(userId)
        this.publisher.publish(getAvailabilityPath(userId), { userId, info: null })
      })

    accountSettingsService.on('change', (userId, settings) => {
      // An offline user's change is stored and gets loaded when they next connect.
      if (this.userSocketsManager.getById(userId)) {
        this.update(userId, toAvailabilityInfo(settings))
      }
    })
  }

  /**
   * Returns the availability of the given user, or `undefined` if they're offline or their stored
   * availability hasn't finished loading yet (in which case a `change` follows once it has).
   */
  get(userId: SbUserId): AvailabilityInfo | undefined {
    return this.byUser.get(userId)
  }

  private async loadStored(
    userSockets: UserSocketsGroup,
    accountSettingsService: AccountSettingsService,
  ): Promise<void> {
    const { userId } = userSockets
    const settings = await accountSettingsService.getSettings(userId)
    // Skip the result if the user disconnected meanwhile (a later connection does its own load),
    // or if a change made during the load already set a newer value.
    if (this.userSocketsManager.getById(userId) !== userSockets || this.byUser.has(userId)) {
      return
    }

    this.update(userId, toAvailabilityInfo(settings))
  }

  private update(userId: SbUserId, info: AvailabilityInfo): void {
    const prev = this.byUser.get(userId)
    if (
      prev &&
      prev.availability === info.availability &&
      prev.statusMessage === info.statusMessage
    ) {
      return
    }

    this.byUser.set(userId, info)
    this.publisher.publish(getAvailabilityPath(userId), { userId, info })
    this.emit('change', userId, info, prev)
  }
}

function toAvailabilityInfo(settings: Readonly<AccountSettings>): AvailabilityInfo {
  return { availability: settings.availability, statusMessage: settings.statusMessage }
}
