import { routerActions } from 'react-router-redux'
import createConditionalRedirect from '../navigation/conditional-redirect.jsx'
import { isAdmin, hasAllPermissions, hasAnyPermission } from './admin-permissions'
import { goToIndex } from '../navigation/action-creators'

export const IsAdminFilter = createConditionalRedirect(
  'IsAdminFilter',
  state => !isAdmin(state.auth),
  () => goToIndex(routerActions.replace)
)

export const CanViewUserProfileFilter = createConditionalRedirect(
  'CanViewUserProfileFilter',
  state => !hasAnyPermission(state.auth, 'editPermissions', 'banUsers'),
  () => routerActions.replace('/admin')
)

export const CanAcceptBetaInvitesFilter = createConditionalRedirect(
  'CanAcceptBetaInvitesFilter',
  state => !hasAllPermissions(state.auth, 'acceptInvites'),
  () => routerActions.replace('/admin')
)

export const CanManageStarcraftPatchesFilter = createConditionalRedirect(
  'CanManageStarcraftPatchesFilter',
  state => !hasAllPermissions(state.auth, 'manageStarcraftPatches'),
  () => routerActions.replace('/admin')
)
