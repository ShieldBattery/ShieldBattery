import readCookies from '../network/read-cookies'
import { isLoggedIn } from '../auth/auth-utils'

export default function isReturningUser(authState) {
  return (isLoggedIn(authState) || readCookies().returning)
}
