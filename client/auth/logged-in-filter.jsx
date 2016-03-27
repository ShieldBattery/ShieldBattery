import { routeActions } from 'redux-simple-router'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isLoggedIn } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  (state, history) => {
    const { router: { location } } = state
    const query = {
      nextPath: history.createPath(location.pathname, location.query)
    }
    return routeActions.push({ pathname: '/login', query })
  }
)

export default LoggedInFilter
