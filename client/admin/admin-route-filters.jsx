import { goToIndex } from '../navigation/action-creators'
import createConditionalRedirect from '../navigation/conditional-redirect'
import { replace } from '../navigation/routing'
import { hasAllPermissions, hasAnyPermission, isAdmin } from './admin-permissions'

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

export const CanManageMapPoolsFilter = createConditionalRedirect(
  'CanManageMapPoolsFilter',
  state => !hasAllPermissions(state.auth, 'manageMapPools'),
  () => replace('/admin'),
)

export const CanManageMatchmakingSeasonsFilter = createConditionalRedirect(
  'CanManageMatchmakingSeasons',
  state => !hasAllPermissions(state.auth, 'manageMatchmakingSeasons'),
  () => replace('/admin'),
)

export const CanManageMatchmakingTimesFilter = createConditionalRedirect(
  'CanManageMatchmakingTimes',
  state => !hasAllPermissions(state.auth, 'manageMatchmakingTimes'),
  () => replace('/admin'),
)

export const CanSeeDebugFilter = createConditionalRedirect(
  'CanSeeDebugFilter',
  state => !hasAllPermissions(state.auth, 'debug'),
  () => replace('/admin'),
)

export const CanManageRallyPointFilter = createConditionalRedirect(
  'CanManageRallyPointFilter',
  state => !hasAllPermissions(state.auth, 'manageRallyPointServers'),
  () => replace('/admin'),
)
