import { TFunction } from 'i18next'
import { CombinedError, useMutation } from 'urql'
import { graphql } from '../gql'
import { MapOwnerClaimBlockedReason } from '../gql/graphql'

/** What the views of a map show about who made it, so they update from a mutation's result. */
export const MapOwner_FamilyOwnerFragment = graphql(/* GraphQL */ `
  fragment MapOwner_FamilyOwnerFragment on MapFamily {
    id
    owner {
      id
      name
    }
    ownerKind
    ownerSetAt
    credit
  }
`)

const ClaimMutation = graphql(/* GraphQL */ `
  mutation MapOwnerClaim($familyId: UUID!, $note: String) {
    mapOwnerClaim(familyId: $familyId, note: $note) {
      id
      granted
      claim {
        id
        status
        note
        createdAt
      }
      family {
        id
        ...MapOwner_FamilyOwnerFragment
      }
    }
  }
`)

const RelinquishMutation = graphql(/* GraphQL */ `
  mutation MapOwnerRelinquish($familyId: UUID!) {
    mapOwnerRelinquish(familyId: $familyId) {
      id
      ...MapOwner_FamilyOwnerFragment
    }
  }
`)

/** Only staff use this, so its result's error isn't translated. */
const RemoveOwnerMutation = graphql(/* GraphQL */ `
  mutation MapFamilyRemoveOwner($familyId: UUID!) {
    mapFamilyRemoveOwner(familyId: $familyId) {
      id
      ...MapOwner_FamilyOwnerFragment
    }
  }
`)

/** Keep in sync with `MAX_CLAIM_NOTE_LENGTH` on the server (maps/families/owners.rs). */
export const MAX_CLAIM_NOTE_LENGTH = 500

/** Keep in sync with `MAX_CREDIT_LENGTH` on the server (maps/families/owners.rs). */
export const MAX_CREDIT_LENGTH = 100

/** Counts code points (not UTF-16 units) to match the server's chars().count(). */
export function textLength(text: string): number {
  return [...text].length
}

export function errorCode(error: CombinedError): unknown {
  return error.graphQLErrors[0]?.extensions?.code
}

/** Says why the current user can't claim a map right now. */
export function claimBlockedText(reason: MapOwnerClaimBlockedReason, t: TFunction): string {
  switch (reason) {
    case MapOwnerClaimBlockedReason.EmailUnverified:
      return t('maps.owner.emailUnverified', 'Verify your email address to claim maps.')
    case MapOwnerClaimBlockedReason.RateLimited:
      return t('maps.owner.rateLimited', "You've claimed too many maps recently. Try again later.")
    case MapOwnerClaimBlockedReason.Restricted:
      return t('maps.owner.restricted', "You're restricted from publishing maps.")
    case MapOwnerClaimBlockedReason.NotListed:
      return t('maps.owner.notListed', 'Only a map with a listed file can be claimed.')
    case MapOwnerClaimBlockedReason.AlreadyOwner:
      return t('maps.owner.alreadyOwner', "You're already this map's maker.")
    default:
      reason satisfies never
      return ownerErrorText(t)
  }
}

export function ownerErrorText(t: TFunction): string {
  return t('maps.owner.error', 'Something went wrong. Please try again later.')
}

function isBlockedReason(code: unknown): code is MapOwnerClaimBlockedReason {
  return Object.values<unknown>(MapOwnerClaimBlockedReason).includes(code)
}

/** What a failed claim tells the user. The server uses blocked reasons as codes. */
export function claimErrorText(error: CombinedError, t: TFunction): string {
  const code = errorCode(error)
  return isBlockedReason(code) ? claimBlockedText(code, t) : ownerErrorText(t)
}

/**
 * Returns a function that claims a map for the current user, resolving to whether they became its
 * owner at once, or rejecting with the server's error.
 */
export function useClaimMapOwner() {
  const [{ fetching }, claim] = useMutation(ClaimMutation)
  const run = async (familyId: string, note?: string): Promise<boolean> => {
    const result = await claim({ familyId, note })
    if (result.error || !result.data) {
      throw result.error ?? new Error('No result')
    }
    return result.data.mapOwnerClaim.granted
  }
  return [run, fetching] as const
}

/** The server's message for an error, for staff, who read it untranslated. */
export function serverErrorText(error: CombinedError): string {
  return error.graphQLErrors[0]?.message ?? error.message
}

/**
 * Returns a function that removes a map's owner as staff, rejecting with the server's reason if
 * that failed.
 */
export function useRemoveMapOwner() {
  const [{ fetching }, removeOwner] = useMutation(RemoveOwnerMutation)
  const run = async (familyId: string): Promise<void> => {
    const result = await removeOwner({ familyId })
    if (result.error || !result.data) {
      throw new Error(result.error ? serverErrorText(result.error) : 'No result')
    }
  }
  return [run, fetching] as const
}

/** Returns a function that gives up the current user's ownership of a map. */
export function useRelinquishMapOwner() {
  const [, relinquish] = useMutation(RelinquishMutation)
  return async (familyId: string): Promise<void> => {
    const result = await relinquish({ familyId })
    if (result.error || !result.data) {
      throw result.error ?? new Error('No result')
    }
  }
}
