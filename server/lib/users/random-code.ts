import { randomBytes } from 'node:crypto'
import { RANDOM_EMAIL_CODE_CHARACTERS } from '../../../common/users/user-network'

// How many potential characters there are
const NUM_POTENTIAL_CHARS = RANDOM_EMAIL_CODE_CHARACTERS.length
// How many characters we need to generate
const CHARS_TO_GEN = 10
// Values above this number have leftover bits that will mess up the distribution when we use mod
// to get a character value
const MAX_ALLOWABLE_RAND = Math.floor(0x10000 / NUM_POTENTIAL_CHARS) * NUM_POTENTIAL_CHARS - 1
// Generate a bit of extra randomness to hopefully have enough "valid" bytes in one go
const BYTES_TO_GEN = 2 * (CHARS_TO_GEN + 1)

/**
 * Returns a secure random code string of the format XXXXX-XXXXX, suitable for things like password
 * reset and email verification codes.
 */
export async function genRandomCode(): Promise<string> {
  const result = []

  while (result.length < CHARS_TO_GEN) {
    const bytes = await asyncRandomBytes(BYTES_TO_GEN)
    let pos = 0
    while (pos < bytes.length && result.length < CHARS_TO_GEN) {
      const value = bytes.readUint16LE(pos)
      pos += 2
      if (value > MAX_ALLOWABLE_RAND) {
        continue
      }

      result.push(RANDOM_EMAIL_CODE_CHARACTERS[value % NUM_POTENTIAL_CHARS])
    }
  }

  const half = Math.floor(CHARS_TO_GEN / 2)
  return result.slice(0, half).join('') + '-' + result.slice(half).join('')
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
