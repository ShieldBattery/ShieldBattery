import readCookies from '../network/read-cookies'
import { isLoggedIn } from '../auth/auth-utils'

export default function isReturningUser(authState) {
  return (
      process.webpackEnv.SB_ENV === 'electron' ||
      isLoggedIn(authState) ||
      readCookies().returning
  )
}
