import { SbUserId } from './sb-user-id'

export const SEARCH_MATCH_HISTORY_LIMIT = 40

/**
 * Information about any user in the system, mainly things that represent the "identity" of the
 * user.
 */
export interface SbUser {
  id: SbUserId
  /** The user's display name. */
  name: string
}

/** Information about the current user. */
export interface SelfUser extends SbUser {
  /** The name the user logs in with (may differ from their display name). */
  loginName: string
  email: string
  emailVerified: boolean
  /** The last version of the privacy policy this user has seen/accepted. */
  acceptedPrivacyVersion: number
  /** The last version of the terms of service this user has seen/accepted. */
  acceptedTermsVersion: number
  /** The last version of the acceptable use policy this user has seen/accepted. */
  acceptedUsePolicyVersion: number
  /**
   * The locale that this user has set, either as an explicit choice or as reported by their
   * browser. This string is a BCP 47 code that will be used locally to select from the available
   * languages for app content, falling back to English if no better alternative can be found.
   *
   * This field was added after many accounts were created, and only accounts that have logged in
   * since then will have a locale present.
   */
  locale?: string
}
