import { routeActions } from 'redux-simple-router'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import isReturningUser from './is-returning-user'

const HasBetaFilter = createConditionalRedirect(
  'HasBetaFilter',
  state => !isReturningUser(state.auth),
  () => routeActions.push('/splash')
)

export default HasBetaFilter
