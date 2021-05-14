import createConditionalRedirect from '../navigation/conditional-redirect'
import { push } from '../navigation/routing'
import { createNextPath, isLoggedIn } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  () => {
    const search = createNextPath(location)
    push({ pathname: '/login', search })
  },
)

export default LoggedInFilter
