import { push } from 'connected-react-router'
import createConditionalRedirect from '../navigation/conditional-redirect'
import { isLoggedIn, createNextPath } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  state => {
    const {
      router: { location },
    } = state
    const search = createNextPath(location)
    return push({ pathname: '/login', search })
  },
)

export default LoggedInFilter
