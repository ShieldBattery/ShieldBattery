import redirectFn from '../navigation/conditional-redirect.jsx'
import { isLoggedIn } from './auth-utils'
import { redirectToLogin } from './auth-utils'

export default redirectFn(isLoggedIn, redirectToLogin)
