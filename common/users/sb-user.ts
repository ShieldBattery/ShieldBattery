import { Jsonify } from '../json'
import { SbUserId } from './sb-user-id'

export const LOGIN_NAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

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
  /** When the user last changed their login name (for rate limiting) */
  lastLoginNameChange?: Date
  /** When the user last changed their display name (for rate limiting) */
  lastNameChange?: Date
  /** Number of display name change tokens available */
  nameChangeTokens: number
}

export type SelfUserJson = Jsonify<SelfUser>

export function toSelfUserJson(user: SelfUser): SelfUserJson {
  return {
    id: user.id,
    name: user.name,
    loginName: user.loginName,
    email: user.email,
    emailVerified: user.emailVerified,
    acceptedPrivacyVersion: user.acceptedPrivacyVersion,
    acceptedTermsVersion: user.acceptedTermsVersion,
    acceptedUsePolicyVersion: user.acceptedUsePolicyVersion,
    locale: user.locale,
    lastLoginNameChange: user.lastLoginNameChange ? Number(user.lastLoginNameChange) : undefined,
    lastNameChange: user.lastNameChange ? Number(user.lastNameChange) : undefined,
    nameChangeTokens: user.nameChangeTokens,
  }
}

export function fromSelfUserJson(userJson: SelfUserJson): SelfUser {
  return {
    id: userJson.id,
    name: userJson.name,
    loginName: userJson.loginName,
    email: userJson.email,
    emailVerified: userJson.emailVerified,
    acceptedPrivacyVersion: userJson.acceptedPrivacyVersion,
    acceptedTermsVersion: userJson.acceptedTermsVersion,
    acceptedUsePolicyVersion: userJson.acceptedUsePolicyVersion,
    locale: userJson.locale,
    lastLoginNameChange: userJson.lastLoginNameChange
      ? new Date(userJson.lastLoginNameChange)
      : undefined,
    lastNameChange: userJson.lastNameChange ? new Date(userJson.lastNameChange) : undefined,
    nameChangeTokens: userJson.nameChangeTokens,
  }
}
