import { EventEmitter } from 'node:events'
import { singleton } from 'tsyringe'
import { AccountSettings } from '../../../common/settings/account-settings'
import { urlPath } from '../../../common/urls'
import { AvailabilityInfo, AvailabilityUpdateEvent } from '../../../common/users/availability'
import { RestrictionKind } from '../../../common/users/restrictions'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import { AccountSettingsService } from '../settings/account-settings-service'
import { UserSocketsGroup, UserSocketsManager } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { RestrictionService } from './restriction-service'

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
 *
 * A chat-restricted user's status message is withheld from everyone else, since it's text they'd be
 * showing to other users. Their own sessions still see it through their account settings.
 */
@singleton()
export class AvailabilityService extends EventEmitter<AvailabilityServiceEvents> {
  /** Online users whose stored availability has loaded. */
  private byUser = new Map<SbUserId, AvailabilityInfo>()
  /**
   * Online users known to be chat restricted. Checked when they connect and added to when a
   * restriction is applied; a restriction expiring takes effect on their next connection.
   */
  private chatRestricted = new Set<SbUserId>()

  constructor(
    private publisher: TypedPublisher<AvailabilityUpdateEvent>,
    private userSocketsManager: UserSocketsManager,
    accountSettingsService: AccountSettingsService,
    restrictionService: RestrictionService,
  ) {
    super()

    userSocketsManager
      .on('newUser', userSockets => {
        this.loadStored(userSockets, accountSettingsService, restrictionService).catch(err => {
          logger.error({ err }, 'error loading availability for new user')
        })
      })
      .on('userQuit', userId => {
        this.byUser.delete(userId)
        this.chatRestricted.delete(userId)
        this.publisher.publish(getAvailabilityPath(userId), { userId, info: null })
      })

    accountSettingsService.on('change', (userId, settings) => {
      // An offline user's change is stored and gets loaded when they next connect.
      if (this.userSocketsManager.getById(userId)) {
        this.update(userId, toAvailabilityInfo(settings))
      }
    })

    restrictionService.on('restrictionApplied', (userId, kind) => {
      if (kind !== RestrictionKind.Chat || !this.userSocketsManager.getById(userId)) {
        return
      }

      this.chatRestricted.add(userId)
      const info = this.byUser.get(userId)
      if (info) {
        this.update(userId, info)
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
    restrictionService: RestrictionService,
  ): Promise<void> {
    const { userId } = userSockets
    const [settings, isChatRestricted] = await Promise.all([
      accountSettingsService.getSettings(userId),
      restrictionService.isRestricted(userId, RestrictionKind.Chat),
    ])
    // Skip the result if the user disconnected meanwhile (a later connection does its own load).
    if (this.userSocketsManager.getById(userId) !== userSockets) {
      return
    }
    // Only ever added here: a restriction applied during the load has already been recorded.
    if (isChatRestricted) {
      this.chatRestricted.add(userId)
    }
    // A change made during the load already set a newer value, but it went out before the
    // restriction was known, so it's re-applied rather than kept as is.
    this.update(userId, this.byUser.get(userId) ?? toAvailabilityInfo(settings))
  }

  private update(userId: SbUserId, stored: AvailabilityInfo): void {
    const info = this.chatRestricted.has(userId) ? { ...stored, statusMessage: '' } : stored
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
