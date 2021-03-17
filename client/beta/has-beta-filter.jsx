import { replace } from '../navigation/routing'
import createConditionalRedirect from '../navigation/conditional-redirect'
import isReturningUser from './is-returning-user'

const HasBetaFilter = createConditionalRedirect(
  'HasBetaFilter',
  state => !isReturningUser(state.auth),
  () => replace('/splash'),
)

export default HasBetaFilter
