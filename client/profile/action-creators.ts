import { push, replace } from '../navigation/routing'
import { urlPath } from '../network/urls'
import { UserProfileSubPage } from './user-profile-sub-page'

/**
 * Navigates to a specific user's profile (and optionally, a specific tab within that).
 */
export function navigateToUserProfile(userId: number, username: string, tab?: UserProfileSubPage) {
  push(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
}

/**
 * Corrects the URL for a specific user's profile if it is already being viewed. This is meant to be
 * used when the client arrived on the page bu the username doesn't match what we have stored for
 * their user ID.
 */
export function correctUsernameForProfile(
  userId: number,
  username: string,
  tab?: UserProfileSubPage,
) {
  replace(urlPath`/users/${userId}/${username}/${tab ?? ''}`)
}
