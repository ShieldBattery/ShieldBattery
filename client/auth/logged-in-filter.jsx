import { routerActions } from 'react-router-redux'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isLoggedIn } from './auth-utils'

const LoggedInFilter = createConditionalRedirect(
  'LoggedInFilter',
  state => !isLoggedIn(state.auth),
  (state, router) => {
    const { routing: { location } } = state
    const query = {
      nextPath: router.createPath({
        pathname: location.pathname,
        query: location.query,
      }),
    }
    return routerActions.push({ pathname: '/login', query })
  },
)

export default LoggedInFilter
