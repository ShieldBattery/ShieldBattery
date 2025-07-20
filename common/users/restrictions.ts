import { TFunction } from 'i18next'

export enum RestrictionKind {
  Chat = 'chat',
}

export const ALL_RESTRICTION_KINDS: ReadonlyArray<RestrictionKind> = Object.values(RestrictionKind)

export enum RestrictionReason {
  Spam = 'spam',
  Harassment = 'harassment',
  HateSpeech = 'hate_speech',
  Toxicity = 'toxicity',
  DisruptiveBehavior = 'disruptive_behavior',
  Other = 'other',
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
    default:
      return reason satisfies never
  }
}

export const ALL_RESTRICTION_REASONS: ReadonlyArray<RestrictionReason> =
  Object.values(RestrictionReason)

export type RestrictionEvent = RestrictionsChangedEvent

export interface ClientRestrictionInfo {
  kind: RestrictionKind
  endTime: number
  reason: RestrictionReason
}

export interface RestrictionsChangedEvent {
  type: 'restrictionsChanged'
  restrictions: ClientRestrictionInfo[]
}
