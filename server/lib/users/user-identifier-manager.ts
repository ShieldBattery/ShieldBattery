import crypto from 'crypto'
import { injectable } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { SbUserId } from '../../../common/users/sb-user-id'
import { BanSource } from '../../../common/users/user-network'
import { DbClient } from '../db'
import { DiscordWebhookNotifier } from '../discord/webhook-notifier'
import logger from '../logging/logger'
import { BanEnacter } from './ban-enacter'
import { banEvasionEndTime } from './ban-evasion'
import {
  ClientIdentifierBuffer,
  ClientIdentifierString,
  MIN_IDENTIFIER_MATCHES,
} from './client-ids'
import { RestrictionService } from './restriction-service'
import {
  countBannedIdentifiers,
  countBannedUserIdentifiers,
  findUsersWithIdentifiers,
  upsertUserIdentifiers,
} from './user-identifiers'
import { findUserById } from './user-model'

export function convertStringIds(
  identifiers: ReadonlyDeep<ClientIdentifierString[]>,
): ClientIdentifierBuffer[] {
  return identifiers.map<[type: number, hash: Buffer]>(([type, hashStr]) => {
    if (type === 0) {
      // browserprints don't get hashed first, so we do that here
      return [type, crypto.createHash('sha256').update(hashStr).digest()]
    } else {
      return [type, Buffer.from(hashStr, 'hex')]
    }
  })
}

@injectable()
export class UserIdentifierManager {
  constructor(
    private banEnacter: BanEnacter,
    private discordNotifier: DiscordWebhookNotifier,
    private restrictionService: RestrictionService,
  ) {}

  async upsert(
    userId: SbUserId,
    identifiers: ReadonlyArray<ClientIdentifierString>,
    withClient?: DbClient,
  ): Promise<void> {
    const convertedIds = convertStringIds(identifiers)
    const { newIdentifiers } = await upsertUserIdentifiers(userId, convertedIds, withClient)
    if (!newIdentifiers.length) {
      return
    }

    // Apply any current restrictions for this user to the new IDs, and any ID restrictions to the
    // user
    await this.restrictionService.handleNewIdentifiers(userId, newIdentifiers)
  }

  /** Persists IDs in the caller's transaction and returns work to await after it commits. */
  async upsertInTransaction(
    userId: SbUserId,
    identifiers: ReadonlyArray<ClientIdentifierString>,
    client: DbClient,
  ): Promise<() => Promise<void>> {
    const { newIdentifiers } = await upsertUserIdentifiers(
      userId,
      convertStringIds(identifiers),
      client,
    )
    // Restriction propagation reads the user and their IDs through separate connections.
    return async () => {
      if (newIdentifiers.length) {
        await this.restrictionService.handleNewIdentifiers(userId, newIdentifiers)
      }
    }
  }

  /** Repairs restriction propagation when an account committed before its response completed. */
  async upsertAndReconcileRestrictions(
    userId: SbUserId,
    identifiers: ReadonlyArray<ClientIdentifierString>,
  ): Promise<void> {
    const convertedIds = convertStringIds(identifiers)
    await upsertUserIdentifiers(userId, convertedIds)
    // Existing IDs may have committed even when the subsequent restriction propagation failed.
    await this.restrictionService.handleNewIdentifiers(userId, convertedIds)
  }

  /**
   * Bans a user if they have enough matching banned identifiers. Returns whether or not they
   * were banned.
   */
  async banUserIfNeeded(userId: SbUserId, withClient?: DbClient): Promise<boolean> {
    const [count, latestBanEnd] = await countBannedUserIdentifiers(userId, withClient)

    if (count >= MIN_IDENTIFIER_MATCHES) {
      const now = Date.now()
      const endTime = banEvasionEndTime(now, latestBanEnd)
      const newBanLengthHours = (Number(endTime) - now) / (1000 * 60 * 60)
      await this.banEnacter.enactBan({
        targetId: userId,
        endTime,
        reason: 'ban evasion',
        source: BanSource.BanEvasion,
      })

      // Notify the staff channel, but no need to wait for it to finish
      Promise.resolve()
        .then(async () => {
          const user = await findUserById(userId)
          if (!user) {
            logger.warn(`User ${userId} not found for ban evasion notification`)
            return
          }

          await this.discordNotifier.notify({
            content:
              `User '${user.name}' [${user.id}] banned for ban evasion ` +
              `for ${Math.round(newBanLengthHours * 10) / 10} hours.\n\n` +
              `${process.env.SB_CANONICAL_HOST}/users/${user.id}/${encodeURIComponent(user.name)}/`,
          })
        })
        .catch(err => {
          logger.error({ err }, 'Error notifying staff of ban evasion')
        })

      return true
    }

    return false
  }

  async isSignupAllowed(
    identifiers: ReadonlyArray<[type: number, hashStr: string]>,
  ): Promise<boolean> {
    const convertedIds = convertStringIds(identifiers)
    const bannedIdentifiers = await countBannedIdentifiers(convertedIds)

    return bannedIdentifiers < MIN_IDENTIFIER_MATCHES
  }

  async findUsersWithIdentifiers(
    identifiers: ReadonlyArray<ClientIdentifierString>,
    withClient?: DbClient,
  ): Promise<SbUserId[]> {
    const convertedIds = convertStringIds(identifiers)
    return findUsersWithIdentifiers(convertedIds, MIN_IDENTIFIER_MATCHES, withClient)
  }
}
