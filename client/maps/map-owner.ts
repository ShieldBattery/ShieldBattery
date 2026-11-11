import { SbMapId } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { MapOwnerClaimBlockedReason } from '../gql/graphql'

/** What the map page's menu offers the viewer about being the map's maker. */
export type ClaimMenuState =
  /** Nothing: the viewer can't claim the map, or it isn't known yet whether they can. */
  | { kind: 'hidden' }
  /** The viewer owns the map, so they can give it up. */
  | { kind: 'relinquish' }
  /** The viewer's claim waits for staff. */
  | { kind: 'pending' }
  /** The viewer could claim the map, but not right now. */
  | {
      kind: 'blocked'
      reason: MapOwnerClaimBlockedReason.EmailUnverified | MapOwnerClaimBlockedReason.RateLimited
    }
  /** The viewer can claim the map: at once (`instant`), or with a note for staff. */
  | { kind: 'claim'; instant: boolean }

/** What the server said claiming the map would do for the viewer. */
export interface ClaimPreviewFacts {
  blockedReason?: MapOwnerClaimBlockedReason | null
  instant: boolean
  hasOpenClaim: boolean
}

/** Decides what the map page's menu offers the viewer about being the map's maker. */
export function claimMenuState(isOwner: boolean, preview?: ClaimPreviewFacts): ClaimMenuState {
  if (isOwner) {
    return { kind: 'relinquish' }
  }
  if (!preview) {
    return { kind: 'hidden' }
  }
  switch (preview.blockedReason) {
    case MapOwnerClaimBlockedReason.Restricted:
    case MapOwnerClaimBlockedReason.NotListed:
    case MapOwnerClaimBlockedReason.AlreadyOwner:
      return { kind: 'hidden' }
    default:
      break
  }
  if (preview.hasOpenClaim) {
    return { kind: 'pending' }
  }
  switch (preview.blockedReason) {
    case MapOwnerClaimBlockedReason.EmailUnverified:
    case MapOwnerClaimBlockedReason.RateLimited:
      return { kind: 'blocked', reason: preview.blockedReason }
    case null:
    case undefined:
      return { kind: 'claim', instant: preview.instant }
    default:
      return preview.blockedReason satisfies never
  }
}

/**
 * The pick a select resolves to: `picked` while it's still one of the `choices`, otherwise the
 * only choice when there's exactly one, otherwise nothing.
 */
export function pickOrOnlyChoice<T extends string>(
  choices: readonly T[],
  picked: T | undefined,
): T | undefined {
  if (picked !== undefined && choices.includes(picked)) {
    return picked
  }
  return choices.length === 1 ? choices[0] : undefined
}

/** A kind of report the map report dialog offers. */
export type MapReportOption =
  | 'wrongMap'
  | 'sameMap'
  | 'wrongDefault'
  | 'wrongOwner'
  | 'inappropriate'

/** What the report dialog knows about the map being reported. */
export interface ReportFamilyFacts {
  ownerId?: SbUserId
  currentId: SbMapId
  files: ReadonlyArray<{ id: SbMapId; listed: boolean }>
}

/**
 * Which files a report option is about: the file the dialog was opened for when it can be the
 * subject (`fixed`), otherwise the files to pick from (`choices`).
 */
export type ReportFileTarget = { fixed: SbMapId } | { choices: SbMapId[] }

export interface ReportOptions {
  /** The options to offer, in display order. */
  options: MapReportOption[]
  /** The file a `wrongDefault` report would be about. Set when that option is offered. */
  wrongDefault?: ReportFileTarget
  /** The file an `inappropriate` report would be about. Set when that option is offered. */
  inappropriate?: ReportFileTarget
}

function targetOf(eligible: SbMapId[], contextFileId: SbMapId | undefined): ReportFileTarget {
  return contextFileId && eligible.includes(contextFileId)
    ? { fixed: contextFileId }
    : { choices: eligible }
}

/**
 * Decides which reports the dialog offers. `fileCount` is how many of the map's files the
 * reporter can see; `family` is unset until the map's details load. A file-specific report is
 * about the file the dialog was opened for when that file can be its subject, and otherwise asks
 * which of the eligible files it's about.
 */
export function mapReportOptions({
  fileCount,
  family,
  viewerId,
  contextFileId,
}: {
  fileCount: number
  family?: ReportFamilyFacts
  viewerId?: SbUserId
  contextFileId?: SbMapId
}): ReportOptions {
  // A map with a single file has no file that could be in the wrong map
  const options: MapReportOption[] = fileCount > 1 ? ['wrongMap', 'sameMap'] : ['sameMap']
  if (!family) {
    return { options }
  }

  const result: ReportOptions = { options }
  const listed = family.files.filter(f => f.listed).map(f => f.id)
  // Only a map nobody owns takes reports about its default, which must be a listed file
  const defaultCandidates = listed.filter(id => id !== family.currentId)
  if (family.ownerId === undefined && listed.length >= 2 && defaultCandidates.length) {
    options.push('wrongDefault')
    result.wrongDefault = targetOf(defaultCandidates, contextFileId)
  }
  if (family.ownerId !== undefined && family.ownerId !== viewerId) {
    options.push('wrongOwner')
  }
  if (listed.length) {
    options.push('inappropriate')
    result.inappropriate = targetOf(listed, contextFileId)
  }
  return result
}
