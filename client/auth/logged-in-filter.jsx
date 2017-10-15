import { routerActions } from 'react-router-redux'
import { createPath } from 'history/PathUtils'
import queryString from 'query-string'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isLoggedIn } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  state => {
    const { routing: { location } } = state
    const search = queryString.stringify({
      nextPath: createPath({
        pathname: location.pathname,
        search: location.search,
      }),
    })
    return routerActions.push({ pathname: '/login', search })
  },
)

export default LoggedInFilter
