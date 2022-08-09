import crypto from 'crypto'
import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user'
import { DbClient } from '../db'
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

const PERMANENT_BAN_TIME = new Date('9001-01-01T23:00:00')

function convertStringIds(
  identifiers: ReadonlyArray<ClientIdentifierString>,
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
  constructor(private banEnacter: BanEnacter) {}

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
    const count = await countBannedUserIdentifiers(userId, true, withClient)

    const banLengthHours = (Number(PERMANENT_BAN_TIME) - Date.now()) / (1000 * 60 * 60)

    if (count >= MIN_IDENTIFIER_MATCHES) {
      await this.banEnacter.enactBan({ targetId: userId, banLengthHours, reason: 'ban evasion' })
      return true
    }

    return false
  }

  async isSignupAllowed(
    isWeb: boolean,
    identifiers: ReadonlyArray<[type: number, hashStr: string]>,
  ): Promise<boolean> {
    const convertedIds = convertStringIds(identifiers)
    const bannedIdentifiers = await countBannedIdentifiers(convertedIds)

    return isWeb ? bannedIdentifiers === 0 : bannedIdentifiers < MIN_IDENTIFIER_MATCHES
  }

  async findUsersWithIdentifiers(
    identifiers: ReadonlyArray<ClientIdentifierString>,
    withClient?: DbClient,
  ): Promise<SbUserId[]> {
    const convertedIds = convertStringIds(identifiers)
    return findUsersWithIdentifiers(convertedIds, MIN_IDENTIFIER_MATCHES, true, withClient)
  }
}
