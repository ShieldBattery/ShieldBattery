import conditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isLoggedIn } from './auth-utils'
import { redirectAfterLogin } from '../navigation/action-creators'

export default conditionalRedirect(isLoggedIn, redirectAfterLogin)
