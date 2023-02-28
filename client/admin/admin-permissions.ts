import { useMemo } from 'react'
import { SbPermissions } from '../../common/users/permissions'
import { AuthState, PermissionsRecord } from '../auth/auth-records'
import { useAppSelector } from '../redux-hooks'

export function isAdmin(authState: AuthState) {
  return isAdminFromPermissions(authState.permissions)
}

function isAdminFromPermissions(permissions: PermissionsRecord) {
  return permissions.toSeq().some(perm => perm)
}

export function hasAllPermissions(
  authState: AuthState,
  ...permissionsToCheck: Array<keyof SbPermissions>
) {
  const perms = authState.permissions
  return permissionsToCheck.every(p => perms[p])
}

export function hasAnyPermission(
  authState: AuthState,
  ...permissionsToCheck: Array<keyof SbPermissions>
) {
  const perms = authState.permissions
  return permissionsToCheck.some(p => perms[p])
}

/**
 * A React hook that returns whether or not the current user has any admin powers.
 */
export function useIsAdmin() {
  const permissions = useAppSelector(s => s.auth.permissions)
  const isAdmin = useMemo(() => isAdminFromPermissions(permissions), [permissions])

  return isAdmin
}
