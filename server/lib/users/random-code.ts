import { randomBytes } from 'node:crypto'
import { RANDOM_EMAIL_CODE_CHARACTERS } from '../../../common/users/user-network'

// How many potential characters there are
const NUM_POTENTIAL_CHARS = RANDOM_EMAIL_CODE_CHARACTERS.length
// Values above this number have leftover bits that will mess up the distribution when we use mod
// to get a character value
const MAX_ALLOWABLE_RAND = Math.floor(0x10000 / NUM_POTENTIAL_CHARS) * NUM_POTENTIAL_CHARS - 1

/**
 * Generates a secure random code of `charCount` characters, formatted as two dash-separated
 * groups.
 */
async function genRandomCodeOfLength(charCount: number): Promise<string> {
  // Generate a bit of extra randomness to hopefully have enough "valid" bytes in one go
  const bytesToGen = 2 * (charCount + 1)
  const result = []

  while (result.length < charCount) {
    const bytes = await asyncRandomBytes(bytesToGen)
    let pos = 0
    while (pos < bytes.length && result.length < charCount) {
      const value = bytes.readUint16LE(pos)
      pos += 2
      if (value > MAX_ALLOWABLE_RAND) {
        continue
      }

      result.push(RANDOM_EMAIL_CODE_CHARACTERS[value % NUM_POTENTIAL_CHARS])
    }
  }

  const half = Math.floor(charCount / 2)
  return result.slice(0, half).join('') + '-' + result.slice(half).join('')
}

/**
 * Returns a secure random code string of the format XXXXX-XXXXX, suitable for things like password
 * reset and email verification codes.
 */
export async function genRandomCode(): Promise<string> {
  return genRandomCodeOfLength(10)
}

/**
 * Returns a shorter secure random code string of the format XXX-XXX, suitable for contexts where
 * ease of transcription matters more than the entropy a full-length code provides (e.g. lobby
 * join codes).
 */
export async function genShortRandomCode(): Promise<string> {
  return genRandomCodeOfLength(6)
}

function asyncRandomBytes(amount: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    randomBytes(amount, (err, buf) => {
      if (err) {
        reject(err)
      } else {
        resolve(buf)
      }
    })
  })
}
