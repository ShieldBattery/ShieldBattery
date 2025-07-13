import crypto from 'crypto'
import { injectable } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { DiscordWebhookNotifier } from '../discord/webhook-notifier'
import logger from '../logging/logger'
import { BanEnacter } from './ban-enacter'
import {
  ClientIdentifierBuffer,
  ClientIdentifierString,
  MIN_IDENTIFIER_MATCHES,
} from './client-ids'
import {
  countBannedIdentifiers,
  countBannedUserIdentifiers,
  findUsersWithIdentifiers,
  upsertUserIdentifiers,
} from './user-identifiers'
import { findUserById } from './user-model'

const MIN_BAN_LENGTH_HOURS = 1
const MAX_BAN_LENGTH_HOURS = 100 * 365 * 24 // 100 years

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
  ) {}

  async upsert(
    userId: SbUserId,
    identifiers: ReadonlyArray<ClientIdentifierString>,
    withClient?: DbClient,
  ): Promise<void> {
    const convertedIds = convertStringIds(identifiers)
    return upsertUserIdentifiers(userId, convertedIds, withClient)
  }

  /**
   * Bans a user if they have enough matching banned identifiers. Returns whether or not they
   * were banned.
   */
  async banUserIfNeeded(userId: SbUserId, withClient?: DbClient): Promise<boolean> {
    const [count, latestBanEnd] = await countBannedUserIdentifiers(userId, true, withClient)

    const currentBanLengthHours = latestBanEnd
      ? (latestBanEnd.getTime() - Date.now()) / (1000 * 60 * 60)
      : 0
    // Double their remaining ban length (clamping to our min/max times)
    const newBanLengthHours = Math.max(
      Math.min(currentBanLengthHours * 2, MAX_BAN_LENGTH_HOURS),
      MIN_BAN_LENGTH_HOURS,
    )

    if (count >= MIN_IDENTIFIER_MATCHES) {
      await this.banEnacter.enactBan({
        targetId: userId,
        banLengthHours: newBanLengthHours,
        reason: 'ban evasion',
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
    return findUsersWithIdentifiers(convertedIds, MIN_IDENTIFIER_MATCHES, true, withClient)
  }
}
