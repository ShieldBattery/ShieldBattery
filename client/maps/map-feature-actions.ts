import { TFunction } from 'i18next'
import { filterColorCodes } from '../../common/maps'
import { graphql } from '../gql'
import { MapFeaturePick_FeatureFragmentFragment } from '../gql/graphql'
import { collectionTitle } from './map-collection-text'
import { MAX_FEATURE_BLURB_LENGTH } from './map-feature-weeks'

// Only staff pick features, so the text here isn't translated.

/** What staff tools show about a week's staff pick. */
export const MapFeaturePick_FeatureFragment = graphql(/* GraphQL */ `
  fragment MapFeaturePick_FeatureFragment on MapFeature {
    id
    week
    blurb
    map {
      id
      name
      family {
        id
        name
        current {
          id
        }
      }
    }
    collection {
      id
      kind
      title
      pool {
        id
        matchmakingType
        startDate
        endDate
      }
    }
  }
`)

/**
 * Selects what the schedule shows of a pick, so a pick set for a week the schedule already lists
 * updates in place.
 */
export const MapFeatureSetMutation = graphql(/* GraphQL */ `
  mutation MapFeatureSet($week: DateTime!, $mapId: SbMapId, $collectionId: UUID, $blurb: String) {
    mapFeatureSet(week: $week, mapId: $mapId, collectionId: $collectionId, blurb: $blurb) {
      id
      shown
      createdBy {
        id
      }
      ...MapFeaturePick_FeatureFragment
    }
  }
`)

export const MapFeatureRemoveMutation = graphql(/* GraphQL */ `
  mutation MapFeatureRemove($week: DateTime!) {
    mapFeatureRemove(week: $week)
  }
`)

/**
 * The name of a week's pick: its map's name, or its collection's title. A collection the viewer
 * can't see anymore has no title to show.
 */
export function featurePickName(
  feature: Pick<MapFeaturePick_FeatureFragmentFragment, 'map' | 'collection'>,
  t: TFunction,
): string {
  if (feature.map) {
    return filterColorCodes(feature.map.name)
  } else if (feature.collection) {
    return collectionTitle(feature.collection, t)
  }
  return 'A collection you can no longer see'
}

/** What a failed change of a week's pick tells staff, given the error code the server sent. */
export function featureErrorText(code: unknown): string {
  switch (code) {
    case 'INVALID_WEEK':
      return "That isn't the start of a week. Pick a week from the list."
    case 'WEEK_PASSED':
      return 'That week is already over. Pick this week or a later one.'
    case 'WEEK_TOO_FAR':
      return 'That week is too far ahead. Picks can be made at most 26 weeks ahead.'
    case 'INVALID_BLURB':
      return `The blurb must be one line of at most ${MAX_FEATURE_BLURB_LENGTH} characters.`
    case 'NOT_LISTED':
      return "This map isn't listed, so it can't be featured."
    case 'NOT_PUBLIC':
      return "Not everyone can see this collection, so it can't be featured."
    case 'NOT_FOUND':
      return "This map or collection doesn't exist anymore."
    case 'FORBIDDEN':
      return "You don't have permission to feature maps."
    case 'BAD_REQUEST':
      return 'Pick either a map or a collection to feature.'
    default:
      return "Couldn't save the pick. Please try again later."
  }
}
