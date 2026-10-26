import { RestrictionKind, RestrictionReason } from './users/restrictions'
import { SbUser } from './users/sb-user'
import { SbUserId } from './users/sb-user-id'
import { BanSource } from './users/user-network'

export enum ModerationActionKind {
  Ban = 'ban',
  Unban = 'unban',
  Restriction = 'restriction',
  RestrictionLift = 'restrictionLift',
  MatchmakingBan = 'matchmakingBan',
}

export const ALL_MODERATION_ACTION_KINDS: ReadonlyArray<ModerationActionKind> =
  Object.values(ModerationActionKind)

interface BaseModerationAction {
  /**
   * The ID of the record the action comes from. Bans and unbans share their ban's ID (as do
   * restrictions and their lifts), so this is only unique together with `kind`.
   */
  id: string
  /** When the action happened, in ms since the epoch. */
  time: number
  userId: SbUserId
}

export interface BanModerationAction extends BaseModerationAction {
  kind: ModerationActionKind.Ban
  endTime: number
  bannedBy?: SbUserId
  reason?: string
  source: BanSource
  /** The target of the ban that caused this one, when this account was banned as a linked one. */
  cascadedFrom?: SbUserId
  gameId?: string
  unbannedAt?: number
}

export interface UnbanModerationAction extends BaseModerationAction {
  kind: ModerationActionKind.Unban
  unbannedBy?: SbUserId
  reason?: string
  /** The source of the ban that was lifted. */
  banSource: BanSource
  cascadedFrom?: SbUserId
}

export interface RestrictionModerationAction extends BaseModerationAction {
  kind: ModerationActionKind.Restriction
  restrictionKind: RestrictionKind
  endTime: number
  restrictedBy?: SbUserId
  reason?: RestrictionReason
  adminNotes?: string
  /** The account whose restriction caused this one, when this one was applied as a linked one. */
  cascadedFrom?: SbUserId
  liftedAt?: number
}

export interface RestrictionLiftModerationAction extends BaseModerationAction {
  kind: ModerationActionKind.RestrictionLift
  restrictionKind: RestrictionKind
  liftedBy?: SbUserId
  reason?: string
  cascadedFrom?: SbUserId
}

export interface MatchmakingBanModerationAction extends BaseModerationAction {
  kind: ModerationActionKind.MatchmakingBan
  endTime: number
  banLevel: number
}

export type ModerationAction =
  | BanModerationAction
  | UnbanModerationAction
  | RestrictionModerationAction
  | RestrictionLiftModerationAction
  | MatchmakingBanModerationAction

export const MODERATION_ACTIONS_PAGE_SIZE = 50

export interface GetModerationActionsQuery {
  /** Comma-separated `ModerationActionKind`s to include. All kinds are included if omitted. */
  kinds?: string
  /** Only include bans and unbans whose ban has this source. Other kinds are unaffected. */
  banSource?: BanSource
  /** Only include restrictions and lifts of this kind. Other kinds are unaffected. */
  restrictionKind?: RestrictionKind
  /** An opaque cursor from a previous response's `nextCursor`. */
  cursor?: string
}

export interface GetModerationActionsResponse {
  actions: ModerationAction[]
  users: SbUser[]
  /** Pass as `cursor` to load the next (older) page. Undefined when there are no more actions. */
  nextCursor?: string
}
