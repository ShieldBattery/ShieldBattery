import { TFunction } from 'i18next'
import { filterColorCodes } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { MapPublishAnswerKind, MapPublishBlockedReason } from '../gql/graphql'
import { protectedMapText, publishBlockedReasonText } from './map-publish'

/** What deciding how a file joins a map needs to know about it. */
export interface AddFileFacts {
  name: string
  listed: boolean
  /** Who published the file, while it's listed. */
  publisherId?: SbUserId
  /** Whether staff took the file out of the listings. Only known to staff. */
  staffDelisted: boolean
  /** The map the file is in now. */
  family: {
    id: string
    name: string
    /** How many of the map's files the viewer can see. */
    fileCount: number
    /** Whether any of the map's files is listed. */
    listed: boolean
    ownerId?: SbUserId
    /** Whether staff credited the map to a maker. */
    credited: boolean
  }
}

/** Why a file can't be added to a map. */
export type AddFileUnavailableReason =
  /** It's listed with another map, or published by someone else. */
  | 'listedElsewhere'
  /** It's the same as a file of another map, so it's listed with that map. */
  | 'inOtherMap'
  /** Its own map has a maker or a credit, which moving the file would merge away. */
  | 'protected'
  | 'staffDelisted'
  | 'noName'

/** How a file joins a map its owner is adding it to. */
export type AddFilePlan =
  /** The listed file moves in, taking the place of its own map. */
  | { kind: 'link' }
  /**
   * The file is published into the map: `JOIN` moves it there, `KEEP` lists it in the map it's
   * already in.
   */
  | { kind: 'publish'; answer: MapPublishAnswerKind.Join | MapPublishAnswerKind.Keep }
  /** The file is listed in the map already. */
  | { kind: 'alreadyHere' }
  | { kind: 'unavailable'; reason: AddFileUnavailableReason; mapName: string }

/**
 * Decides how `file` can join the map `familyId`, which `viewerId` owns. These are the server's
 * rules for publishing and linking a file, as far as the client can tell them: a file staff
 * delisted is only known as such to staff.
 */
export function planAddFile(file: AddFileFacts, familyId: string, viewerId: SbUserId): AddFilePlan {
  const unavailable = (reason: AddFileUnavailableReason): AddFilePlan => ({
    kind: 'unavailable',
    reason,
    mapName: file.family.name,
  })
  const alone = file.family.fileCount <= 1
  // Moving a file out of a map it's alone in merges that map away
  const isProtected =
    alone &&
    (file.family.credited ||
      (file.family.ownerId !== undefined && file.family.ownerId !== viewerId))

  if (file.listed) {
    if (file.family.id === familyId) {
      return { kind: 'alreadyHere' }
    }
    if (file.publisherId !== viewerId || !alone) {
      return unavailable('listedElsewhere')
    }
    return isProtected ? unavailable('protected') : { kind: 'link' }
  }

  if (file.staffDelisted) {
    return unavailable('staffDelisted')
  } else if (!filterColorCodes(file.name).trim()) {
    return unavailable('noName')
  } else if (file.family.id === familyId) {
    return { kind: 'publish', answer: MapPublishAnswerKind.Keep }
  } else if (!alone && file.family.listed) {
    return unavailable('inOtherMap')
  } else if (isProtected) {
    return unavailable('protected')
  }
  return { kind: 'publish', answer: MapPublishAnswerKind.Join }
}

/** Says why a file can't be added to a map. */
export function addFileUnavailableText(
  plan: Extract<AddFilePlan, { kind: 'unavailable' }>,
  t: TFunction,
): string {
  const mapName = filterColorCodes(plan.mapName)
  switch (plan.reason) {
    case 'listedElsewhere':
      return t('maps.owner.publishedElsewhere', 'This file is already published in {{mapName}}.', {
        mapName,
      })
    case 'inOtherMap':
      return t('maps.owner.inOtherMap', 'This file is already part of {{mapName}}.', { mapName })
    case 'protected':
      return protectedMapText(t)
    case 'staffDelisted':
      return publishBlockedReasonText(MapPublishBlockedReason.StaffDelisted, t)
    case 'noName':
      return publishBlockedReasonText(MapPublishBlockedReason.EmptyName, t)
    default:
      return plan.reason satisfies never
  }
}

/** What came of making a file that just joined a map its recommended file. */
export type RecommendedOutcome = 'made' | 'failed' | 'skipped'

/**
 * Says that a file joined `mapName`, and whether it became the recommended file. `published` is
 * for a file that was published into the map, rather than moved in already listed.
 */
export function joinedMessage(
  {
    mapName: rawMapName,
    recommended,
    published = false,
  }: { mapName: string; recommended: RecommendedOutcome; published?: boolean },
  t: TFunction,
): string {
  const mapName = filterColorCodes(rawMapName)
  switch (recommended) {
    case 'made':
      return published
        ? t(
            'maps.publish.publishedJoinedRecommended',
            'Published as part of {{mapName}} as the recommended file',
            { mapName },
          )
        : t('maps.owner.addedRecommended', 'Added to {{mapName}} as the recommended file', {
            mapName,
          })
    case 'failed':
      return published
        ? t(
            'maps.publish.publishedJoinedNotRecommended',
            "Published as part of {{mapName}}, but couldn't make it recommended",
            { mapName },
          )
        : t(
            'maps.owner.addedNotRecommended',
            "Added to {{mapName}}, but couldn't make it recommended",
            { mapName },
          )
    case 'skipped':
      return published
        ? t('maps.publish.publishedJoined', 'Published as part of {{mapName}}', { mapName })
        : t('maps.publish.linked', 'Added to {{mapName}}', { mapName })
    default:
      return recommended satisfies never
  }
}
