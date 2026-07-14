import { TFunction } from 'i18next'

export enum RestrictionKind {
  Chat = 'chat',
  Reporting = 'reporting',
  Matchmaking = 'matchmaking',
  AvatarUpload = 'avatar_upload',
}

export const ALL_RESTRICTION_KINDS: ReadonlyArray<RestrictionKind> = Object.values(RestrictionKind)

export enum RestrictionReason {
  // Chat restriction reasons
  Spam = 'spam',
  Harassment = 'harassment',
  HateSpeech = 'hate_speech',
  Toxicity = 'toxicity',
  DisruptiveBehavior = 'disruptive_behavior',
  Other = 'other',
  // Matchmaking restriction reasons
  Cheating = 'cheating',
  LeftGame = 'left_game',
  Griefing = 'griefing',
  // Avatar upload restriction reasons
  InappropriateContent = 'inappropriate_content',
}

export function restrictionReasonToLabel(reason: RestrictionReason, t: TFunction): string {
  switch (reason) {
    case RestrictionReason.Spam:
      return t('users.restrictions.reason.spam', 'Spam')
    case RestrictionReason.Harassment:
      return t('users.restrictions.reason.harassment', 'Harassment')
    case RestrictionReason.HateSpeech:
      return t('users.restrictions.reason.hate_speech', 'Hate speech')
    case RestrictionReason.Toxicity:
      return t('users.restrictions.reason.toxicity', 'Toxicity')
    case RestrictionReason.DisruptiveBehavior:
      return t('users.restrictions.reason.disruptive_behavior', 'Disruptive behavior')
    case RestrictionReason.Other:
      return t('users.restrictions.reason.other', 'Other')
    case RestrictionReason.Cheating:
      return t('users.restrictions.reason.cheating', 'Cheating or exploiting')
    case RestrictionReason.LeftGame:
      return t('users.restrictions.reason.left_game', 'Left the game')
    case RestrictionReason.Griefing:
      return t('users.restrictions.reason.griefing', 'Griefing')
    case RestrictionReason.InappropriateContent:
      return t('users.restrictions.reason.inappropriate_content', 'Inappropriate content')
    default:
      return reason satisfies never
  }
}

export const ALL_RESTRICTION_REASONS: ReadonlyArray<RestrictionReason> =
  Object.values(RestrictionReason)

/**
 * The preset reasons available for each restriction kind. Kinds with an empty list don't use a
 * reason at all (nothing is stored and nothing is shown to the user). This is the source of truth
 * for both the admin UI's options and the server's per-kind validation.
 */
export const RESTRICTION_REASONS_BY_KIND: Record<
  RestrictionKind,
  ReadonlyArray<RestrictionReason>
> = {
  [RestrictionKind.Chat]: [
    RestrictionReason.Spam,
    RestrictionReason.Harassment,
    RestrictionReason.HateSpeech,
    RestrictionReason.Toxicity,
    RestrictionReason.DisruptiveBehavior,
    RestrictionReason.Other,
  ],
  [RestrictionKind.Reporting]: [],
  [RestrictionKind.Matchmaking]: [
    RestrictionReason.Cheating,
    RestrictionReason.LeftGame,
    RestrictionReason.Griefing,
  ],
  [RestrictionKind.AvatarUpload]: [
    RestrictionReason.InappropriateContent,
    RestrictionReason.Harassment,
    RestrictionReason.HateSpeech,
    RestrictionReason.Other,
  ],
}

export type RestrictionEvent = RestrictionsChangedEvent

export interface ClientRestrictionInfo {
  kind: RestrictionKind
  endTime: number
  reason?: RestrictionReason
}

export interface RestrictionsChangedEvent {
  type: 'restrictionsChanged'
  restrictions: ClientRestrictionInfo[]
}
