import { routerActions as routeActions } from 'react-router-redux'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isAdmin, checkPermissions } from './admin-utils'
import { goToIndex } from '../navigation/action-creators'

export const IsAdminFilter = createConditionalRedirect(
  'IsAdminFilter',
  state => !isAdmin(state.auth),
  () => goToIndex(routeActions.replace)
)

export const CanEditPermissionsFilter = createConditionalRedirect(
  'CanEditPermissionsFilter',
  state => !checkPermissions(state.auth, 'editPermissions'),
  () => routeActions.replace('/admin')
)

export const CanAcceptBetaInvitesFilter = createConditionalRedirect(
  'CanAcceptBetaInvitesFilter',
  state => !checkPermissions(state.auth, 'acceptInvites'),
  () => routeActions.replace('/admin')
)
