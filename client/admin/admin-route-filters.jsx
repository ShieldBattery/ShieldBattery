import { replace } from '../navigation/routing'
import createConditionalRedirect from '../navigation/conditional-redirect'
import { isAdmin, hasAllPermissions, hasAnyPermission } from './admin-permissions'
import { goToIndex } from '../navigation/action-creators'

export const IsAdminFilter = createConditionalRedirect(
  'IsAdminFilter',
  state => !isAdmin(state.auth),
  () => goToIndex(replace),
)

export const CanViewUserProfileFilter = createConditionalRedirect(
  'CanViewUserProfileFilter',
  state => !hasAnyPermission(state.auth, 'editPermissions', 'banUsers'),
  () => replace('/admin'),
)

export const CanAcceptBetaInvitesFilter = createConditionalRedirect(
  'CanAcceptBetaInvitesFilter',
  state => !hasAllPermissions(state.auth, 'acceptInvites'),
  () => replace('/admin'),
)

export const CanManageMapPoolsFilter = createConditionalRedirect(
  'CanManageMapPoolsFilter',
  state => !hasAllPermissions(state.auth, 'manageMapPools'),
  () => replace('/admin'),
)

export const CanManageMatchmakingTimesFilter = createConditionalRedirect(
  'CanManageMatchmakingTimes',
  state => !hasAllPermissions(state.auth, 'manageMatchmakingTimes'),
  () => replace('/admin'),
)
