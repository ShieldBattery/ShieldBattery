import crypto from 'crypto'
import { injectable } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user'
import { DbClient } from '../db'
import { upsertUserIdentifiers } from './user-identifiers'

@injectable()
export class UserIdentifierManager {
  async upsert(
    userId: SbUserId,
    identifiers: ReadonlyArray<[type: number, hashStr: string]>,
    withClient?: DbClient,
  ): Promise<void> {
    const convertedIds = identifiers.map<[type: number, hash: Buffer]>(([type, hashStr]) => {
      if (type === 0) {
        // browserprints don't get hashed first, so we do that here
        return [type, crypto.createHash('sha256').update(hashStr).digest()]
      } else {
        return [type, Buffer.from(hashStr, 'hex')]
      }
    })

    return upsertUserIdentifiers(userId, convertedIds, withClient)
  }
}
