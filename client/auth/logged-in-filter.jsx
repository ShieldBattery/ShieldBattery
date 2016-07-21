import { routerActions as routeActions } from 'react-router-redux'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isLoggedIn } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  (location, router) => {
    const query = {
      nextPath: router.createPath({ pathname: location.pathname, query: location.query })
    }
    return routeActions.push({ pathname: '/login', query })
  }
)

export default LoggedInFilter
