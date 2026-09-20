import { USERNAME_MAXLENGTH } from '../../../common/constants'
import { randomInt, randomItem } from '../../../common/random'

const ADJECTIVES: ReadonlyArray<string> = [
  'Burrowed',
  'Cloaked',
  'Dark',
  'Fallen',
  'Feral',
  'Grim',
  'Hollow',
  'Iron',
  'Lurking',
  'Rogue',
  'Sieged',
  'Silent',
  'Stimmed',
  'Swift',
  'Warped',
]

const NOUNS: ReadonlyArray<string> = [
  'Archon',
  'Corsair',
  'Defiler',
  'Dragoon',
  'Drone',
  'Firebat',
  'Ghost',
  'Goliath',
  'Hatchery',
  'Hydra',
  'Larva',
  'Lurker',
  'Marine',
  'Medic',
  'Mutalisk',
  'Nexus',
  'Overlord',
  'Probe',
  'Pylon',
  'Queen',
  'Reaver',
  'SCV',
  'Scourge',
  'Scout',
  'Templar',
  'Ultra',
  'Vulture',
  'Wraith',
  'Zealot',
  'Zergling',
]

const MIN_DIGITS = 2
const MAX_DIGITS = 3

const SHORTEST_NOUN_LENGTH = Math.min(...NOUNS.map(n => n.length))

/**
 * Generates a random StarCraft-flavored display name of the form `<Adjective><Noun><digits>`, e.g.
 * `SiegedMarine42`. The result always satisfies `isValidUsername`: every word is alphanumeric, and
 * the word pair is chosen to leave room for the digits within `USERNAME_MAXLENGTH`.
 */
export function generateRandomDisplayName(): string {
  const digitCount = randomInt(MIN_DIGITS, MAX_DIGITS + 1)
  let digits = ''
  for (let i = 0; i < digitCount; i++) {
    digits += String(randomInt(0, 10))
  }

  const wordBudget = USERNAME_MAXLENGTH - digitCount
  const adjective = randomItem(
    ADJECTIVES.filter(a => a.length + SHORTEST_NOUN_LENGTH <= wordBudget),
  )
  const noun = randomItem(NOUNS.filter(n => adjective.length + n.length <= wordBudget))

  return `${adjective}${noun}${digits}`
}
