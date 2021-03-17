import { push } from '../navigation/routing'
import createConditionalRedirect from '../navigation/conditional-redirect'
import { isLoggedIn, createNextPath } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  () => {
    const search = createNextPath(location)
    push({ pathname: '/login', search })
  },
)

export default LoggedInFilter
