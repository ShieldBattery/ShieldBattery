import { routerActions } from 'react-router-redux'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isLoggedIn, createNextPath } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  state => {
    const {
      routing: { location },
    } = state
    const search = createNextPath(location)
    return routerActions.push({ pathname: '/login', search })
  },
)

export default LoggedInFilter
