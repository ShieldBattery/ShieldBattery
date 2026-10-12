import type { TitleId, TitleMetrics } from './titles'
import type { SbUser } from './users/sb-user'

/** A title a user holds. */
export interface UnlockedTitleJson {
  id: TitleId
  /** When the title was earned or granted, as a UTC timestamp in milliseconds. */
  unlockedAt: number
}

export interface GetSelfTitlesResponse {
  unlocked: UnlockedTitleJson[]
  /** The title the user displays, or `undefined` for Novice. */
  equipped?: TitleId
  metrics: TitleMetrics
}

export interface EquipTitleRequest {
  titleId: TitleId
}

export interface EquipTitleResponse {
  /** The user's updated info, with the newly equipped title. */
  user: SbUser
}

export interface AdminGetUserTitlesResponse {
  unlocked: UnlockedTitleJson[]
}
