import { replace } from 'connected-react-router'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import isReturningUser from './is-returning-user'

const HasBetaFilter = createConditionalRedirect(
  'HasBetaFilter',
  state => !isReturningUser(state.auth),
  () => replace('/splash'),
)

export default HasBetaFilter
