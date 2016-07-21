import { routerActions as routeActions } from 'react-router-redux'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import isReturningUser from './is-returning-user'

const HasBetaFilter = createConditionalRedirect(
  'HasBetaFilter',
  state => !isReturningUser(state.auth),
  () => routeActions.replace('/splash')
)

export default HasBetaFilter
