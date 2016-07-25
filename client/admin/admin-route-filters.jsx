import { routerActions } from 'react-router-redux'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isAdmin, checkPermissions } from './admin-utils'
import { goToIndex } from '../navigation/action-creators'

export const IsAdminFilter = createConditionalRedirect(
  'IsAdminFilter',
  state => !isAdmin(state.auth),
  () => goToIndex(routerActions.replace)
)

export const CanEditPermissionsFilter = createConditionalRedirect(
  'CanEditPermissionsFilter',
  state => !checkPermissions(state.auth, 'editPermissions'),
  () => routerActions.replace('/admin')
)

export const CanAcceptBetaInvitesFilter = createConditionalRedirect(
  'CanAcceptBetaInvitesFilter',
  state => !checkPermissions(state.auth, 'acceptInvites'),
  () => routerActions.replace('/admin')
)
