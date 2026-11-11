import { TFunction } from 'i18next'
import { MapPublishBlockedReason } from '../gql/graphql'

export function publishGenericErrorText(t: TFunction): string {
  return t('maps.publish.error', 'Something went wrong. Please try again later.')
}

/** Says why the current user can't publish a file. */
export function publishBlockedReasonText(reason: MapPublishBlockedReason, t: TFunction): string {
  switch (reason) {
    case MapPublishBlockedReason.AlreadyListed:
      return t('maps.publish.alreadyListed', 'This file is already published.')
    case MapPublishBlockedReason.Restricted:
      return t('maps.publish.restricted', "You're restricted from publishing maps.")
    case MapPublishBlockedReason.EmailUnverified:
      return t('maps.publish.emailUnverified', 'Verify your email address to publish maps.')
    case MapPublishBlockedReason.RateLimited:
      return t(
        'maps.publish.rateLimited',
        "You've published a lot of maps today. Try again tomorrow.",
      )
    case MapPublishBlockedReason.NotInLibrary:
      return t('maps.publish.notInLibrary', 'Add this file to your maps to publish it.')
    case MapPublishBlockedReason.EmptyName:
      return t('maps.publish.emptyName', "This file has no name, so it can't be published.")
    case MapPublishBlockedReason.StaffDelisted:
      return t(
        'maps.publish.staffDelisted',
        "Staff took this file out of the listings, so it can't be published.",
      )
    default:
      reason satisfies never
      return publishGenericErrorText(t)
  }
}

export function protectedMapText(t: TFunction): string {
  return t(
    'maps.publish.protectedMap',
    "This file's map has a maker, so it can't be added to another map.",
  )
}

/** Says why a file in a ladder map pool can't be taken out of the listings or out of its map. */
export function inLadderPoolText(t: TFunction): string {
  return t(
    'maps.publish.inLadderPool',
    "This file is in a current or upcoming ladder map pool, so it can't be taken out of the listings or out of its map.",
  )
}

/**
 * What a failed unpublish, delist, unlink, move or split tells the user, given the error code the
 * server sent and the text to show for any other failure.
 */
export function fileChangeErrorText(code: unknown, fallback: string, t: TFunction): string {
  return code === 'IN_LADDER_POOL' ? inLadderPoolText(t) : fallback
}

function isBlockedReason(code: unknown): code is MapPublishBlockedReason {
  return Object.values<unknown>(MapPublishBlockedReason).includes(code)
}

/**
 * What a failed publish or link tells the user, given the error code the server sent. The server
 * uses blocked reasons as codes.
 */
export function publishErrorText(code: unknown, t: TFunction): string {
  if (code === 'NOT_SUGGESTED') {
    return t('maps.publish.notSuggested', 'That map is no longer suggested for this file.')
  } else if (isBlockedReason(code)) {
    return publishBlockedReasonText(code, t)
  } else if (code === 'PROTECTED_MAP') {
    return protectedMapText(t)
  } else if (code === 'HAS_EXISTING_MAP') {
    return t(
      'maps.publish.hasExistingMap',
      "This file is already part of another map, so it can't be added here.",
    )
  } else {
    return publishGenericErrorText(t)
  }
}

/** How alike a file is to the file of a map suggested as the one it's a version of. */
export interface PublishEvidence {
  /** The share of the walkable terrain the two files have in common, from 0 to 1. */
  similarity: number
  /** Whether both files are melee maps, or both are UMS maps. */
  sameKind: boolean
  /** How alike the two files' triggers are, from 0 to 1, when both are UMS maps. */
  triggerSimilarity?: number | null
  /** Whether the files have the same resources. */
  sameResources: boolean
}

/** The terrain similarity from which two files count as having the same terrain. */
const SAME_TERRAIN_SIMILARITY = 0.995
/** The trigger similarity from which two files count as having the same triggers. */
const SAME_TRIGGERS_SIMILARITY = 0.9
/** The trigger similarity below which two files count as having different triggers. */
const DIFFERENT_TRIGGERS_SIMILARITY = 0.5

/**
 * Says why a map is suggested as the one a file is a version of, e.g.
 * `97% same terrain · same resources`.
 */
export function publishEvidenceText(evidence: PublishEvidence, t: TFunction): string {
  const parts: string[] = []
  if (evidence.similarity >= SAME_TERRAIN_SIMILARITY) {
    parts.push(t('maps.publish.sameTerrain', 'same terrain'))
  } else {
    // Rounded down, so files that aren't the same never read as 100%. The small bias keeps
    // floating point error (0.29 * 100 = 28.999…) from taking a whole percent off.
    const percent = Math.floor(evidence.similarity * 100 + 1e-9)
    parts.push(t('maps.publish.terrainPercent', '{{percent}}% same terrain', { percent }))
  }
  if (evidence.sameResources) {
    parts.push(t('maps.publish.sameResources', 'same resources'))
  }
  if (!evidence.sameKind) {
    parts.push(t('maps.publish.differentKind', 'different game type'))
  }
  const triggers = evidence.triggerSimilarity
  if (triggers !== null && triggers !== undefined) {
    if (triggers >= SAME_TRIGGERS_SIMILARITY) {
      parts.push(t('maps.publish.sameTriggers', 'same triggers'))
    } else if (triggers < DIFFERENT_TRIGGERS_SIMILARITY) {
      parts.push(t('maps.publish.differentTriggers', 'different triggers'))
    }
  }
  return parts.join(' · ')
}
