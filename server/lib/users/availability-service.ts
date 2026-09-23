import { EventEmitter } from 'node:events'
import { singleton } from 'tsyringe'
import { AccountSettings } from '../../../common/settings/account-settings'
import { urlPath } from '../../../common/urls'
import {
  AvailabilityInfo,
  AvailabilityUpdateEvent,
  UserAvailability,
} from '../../../common/users/availability'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { RestrictionKind } from '../../../common/users/restrictions'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import { AccountSettingsService } from '../settings/account-settings-service'
import {
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { ActivityStatusService } from './activity-status-service'
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
 * Tracks the availability of every online user and publishes it to their friends and to the user's
 * own sessions. Other audiences (chat channels) listen to `change` and deliver it over their own
 * paths.
 *
 * The published availability is what the user has stored in their account settings, except that a
 * user stored as Online is shown as Away while every one of their connected clients reports its
 * user as idle and they aren't playing a game. That never writes to the stored availability, and a
 * user who chose Away or Do not disturb themselves is always shown as they chose.
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
  /** Online users whose stored availability has loaded (or been changed since they connected). */
  private stored = new Map<SbUserId, AvailabilityInfo>()
  /** What was last published for each online user. */
  private published = new Map<SbUserId, AvailabilityInfo>()
  /**
   * Whether each connected client of each online user last reported its user as idle, keyed by
   * client ID. A client counts as active until it reports otherwise. Web clients never report
   * (a page can't observe input outside itself), so they stay active for as long as they're
   * connected and keep their user from being shown as Away.
   */
  private clientIdle = new Map<SbUserId, Map<string, boolean>>()
  /**
   * Online users known to be chat restricted. Checked when they connect and added to when a
   * restriction is applied; a restriction expiring takes effect on their next connection.
   */
  private chatRestricted = new Set<SbUserId>()

  constructor(
    private publisher: TypedPublisher<AvailabilityUpdateEvent>,
    private userSocketsManager: UserSocketsManager,
    clientSocketsManager: ClientSocketsManager,
    private activityStatusService: ActivityStatusService,
    accountSettingsService: AccountSettingsService,
    restrictionService: RestrictionService,
  ) {
    super()

    // `ClientSocketsManager` handles each connection before `UserSocketsManager` does, so a user's
    // first client is known here before `newUser`, and their last one is gone before `userQuit`.
    clientSocketsManager
      .on('newClient', client => {
        let clients = this.clientIdle.get(client.userId)
        if (!clients) {
          clients = new Map()
          this.clientIdle.set(client.userId, clients)
        }
        clients.set(client.clientId, false)
        this.refresh(client.userId)
      })
      .on('clientQuit', client => {
        const clients = this.clientIdle.get(client.userId)
        if (!clients?.delete(client.clientId)) {
          return
        }
        if (clients.size) {
          this.refresh(client.userId)
        } else {
          // The user is going offline, which `userQuit` publishes right after this.
          this.clientIdle.delete(client.userId)
        }
      })

    userSocketsManager
      .on('newUser', userSockets => {
        const { userId } = userSockets
        // A user's own sessions show the published availability next to their stored choice (which
        // they get from their account settings), so they can see when they're shown as Away.
        userSockets.subscribe<AvailabilityUpdateEvent>(getAvailabilityPath(userId), async () => {
          const info = this.published.get(userId)
          return info ? { userId, info } : undefined
        })
        this.loadStored(userSockets, accountSettingsService, restrictionService).catch(err => {
          logger.error({ err }, 'error loading availability for new user')
        })
      })
      .on('userQuit', userId => {
        this.stored.delete(userId)
        this.published.delete(userId)
        this.clientIdle.delete(userId)
        this.chatRestricted.delete(userId)
        this.publisher.publish(getAvailabilityPath(userId), { userId, info: null })
      })

    accountSettingsService.on('change', (userId, settings) => {
      // An offline user's change is stored and gets loaded when they next connect.
      if (this.userSocketsManager.getById(userId)) {
        this.stored.set(userId, toAvailabilityInfo(settings))
        this.refresh(userId)
      }
    })

    restrictionService.on('restrictionApplied', (userId, kind) => {
      if (kind !== RestrictionKind.Chat || !this.userSocketsManager.getById(userId)) {
        return
      }

      this.chatRestricted.add(userId)
      this.refresh(userId)
    })

    // A user playing a game is never shown as Away: they're often not giving any input the idle
    // reports can see, or are just watching the game play out.
    activityStatusService.on('change', userId => {
      this.refresh(userId)
    })
  }

  /**
   * Returns the availability of the given user, or `undefined` if they're offline or their stored
   * availability hasn't finished loading yet (in which case a `change` follows once it has).
   */
  get(userId: SbUserId): AvailabilityInfo | undefined {
    return this.published.get(userId)
  }

  /**
   * Records whether a connected client has seen its user go idle. A report for a client that isn't
   * connected is ignored: its reports stopped counting when it disconnected, and it reports again
   * once it reconnects.
   */
  setClientIdle(userId: SbUserId, clientId: string, idle: boolean): void {
    const clients = this.clientIdle.get(userId)
    if (!clients?.has(clientId)) {
      return
    }

    clients.set(clientId, idle)
    this.refresh(userId)
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
    // A change made during the load is newer than what was loaded, so it's kept (and published
    // again below if the restriction now withholds its status message).
    if (!this.stored.has(userId)) {
      this.stored.set(userId, toAvailabilityInfo(settings))
    }
    this.refresh(userId)
  }

  /** Whether every connected client of the user reports them idle and they aren't in a game. */
  private isIdle(userId: SbUserId): boolean {
    const clients = this.clientIdle.get(userId)
    if (!clients?.size) {
      return false
    }
    for (const idle of clients.values()) {
      if (!idle) {
        return false
      }
    }

    return this.activityStatusService.getStatus(userId) !== FriendActivityStatus.InGame
  }

  /** Publishes what the given user should be shown as, if that differs from what was published. */
  private refresh(userId: SbUserId): void {
    const stored = this.stored.get(userId)
    if (!stored || !this.userSocketsManager.getById(userId)) {
      return
    }

    const info: AvailabilityInfo = {
      availability:
        stored.availability === UserAvailability.Online && this.isIdle(userId)
          ? UserAvailability.Away
          : stored.availability,
      statusMessage: this.chatRestricted.has(userId) ? '' : stored.statusMessage,
    }
    const prev = this.published.get(userId)
    if (
      prev &&
      prev.availability === info.availability &&
      prev.statusMessage === info.statusMessage
    ) {
      return
    }

    this.published.set(userId, info)
    this.publisher.publish(getAvailabilityPath(userId), { userId, info })
    this.emit('change', userId, info, prev)
  }
}

function toAvailabilityInfo(settings: Readonly<AccountSettings>): AvailabilityInfo {
  return { availability: settings.availability, statusMessage: settings.statusMessage }
}
