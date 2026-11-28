import type { IntRange } from 'type-fest'
import { SbUserId } from '../users/sb-user-id'

export const NUM_ANONYMIZED_NAMES = 6

export type AnonymizedNameIndex = IntRange<0, typeof NUM_ANONYMIZED_NAMES>

/** Preferences captured when a ranked match begins, and held through its draft and game. */
export interface ZenModeSettings {
  anonymizePlayers: boolean
  muteChat: boolean
}

/** Public match metadata. Aliases are independent of a player's account and map spawn position. */
export interface ZenPlayer {
  userId: SbUserId
  nameIndex: AnonymizedNameIndex
  muteChat: boolean
  /** Filled by the app at launch, using the same translation as the draft. */
  localizedAlias?: string
}
