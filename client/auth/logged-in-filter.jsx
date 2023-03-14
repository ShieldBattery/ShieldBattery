import createConditionalRedirect from '../navigation/conditional-redirect'
import { replace } from '../navigation/routing'
import { createNextPath, isLoggedIn } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  () => {
    const search = createNextPath(location)
    replace({ pathname: '/login', search })
  },
)

export default LoggedInFilter
